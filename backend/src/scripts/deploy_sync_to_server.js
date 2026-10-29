import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_SCRIPTS_DIR = __dirname;
const LOCAL_SRC_DIR = path.resolve(__dirname, '..');
const REMOTE_MODULE_DIR = '/home/admin-irg/sistemas/irg-portal/modules/control_acceso';

const filesToUpload = [
  {
    local: path.join(LOCAL_SCRIPTS_DIR, 'sync_crosschex_linux.py'),
    remote: `${REMOTE_MODULE_DIR}/backend/src/scripts/sync_crosschex_linux.py`
  },
  {
    local: path.join(LOCAL_SRC_DIR, 'services/dataStore.js'),
    remote: `${REMOTE_MODULE_DIR}/backend/src/services/dataStore.js`
  },
  {
    local: path.join(LOCAL_SRC_DIR, 'routes/api.js'),
    remote: `${REMOTE_MODULE_DIR}/backend/src/routes/api.js`
  }
];

const conn = new Client();

conn.on('ready', () => {
  console.log('✅ Conexión SSH establecida con 10.0.0.10.');

  conn.sftp((err, sftp) => {
    if (err) {
      console.error('❌ Error SFTP:', err);
      conn.end();
      return;
    }

    let uploaded = 0;
    filesToUpload.forEach(({ local, remote }) => {
      console.log(`📤 Subiendo ${path.basename(local)} -> ${remote}...`);
      const readStream = fs.createReadStream(local);
      const writeStream = sftp.createWriteStream(remote);

      writeStream.on('close', () => {
        uploaded++;
        console.log(`   ✅ ${path.basename(local)} subido con éxito.`);
        if (uploaded === filesToUpload.length) {
          setupServer();
        }
      });

      readStream.pipe(writeStream);
    });
  });

  function setupServer() {
    const COMMANDS = [
      'echo "=== 1. PERMISOS DE EJECUCIÓN ==="',
      `chmod +x ${REMOTE_MODULE_DIR}/backend/src/scripts/sync_crosschex_linux.py`,
      `chown -R admin-irg:admin-irg ${REMOTE_MODULE_DIR}/backend`,
      
      'echo "=== 2. CONFIGURAR CREDENCIALES SMB Y FSTAB ==="',
      'echo "username=anviz" > /etc/crosschex-credentials',
      'echo "password=anviz" >> /etc/crosschex-credentials',
      'chmod 600 /etc/crosschex-credentials',
      'mkdir -p /mnt/crosschex',
      
      // Asegurar entrada en /etc/fstab si no existe
      'grep -q "//10.0.0.89/CrossChex" /etc/fstab || echo "//10.0.0.89/CrossChex\\040Standard /mnt/crosschex cifs credentials=/etc/crosschex-credentials,ro,noperm,_netdev,vers=3.0,nofail 0 0" >> /etc/fstab',
      'mount -a || true',
      
      'echo "=== 3. CONFIGURAR CRON JOB EN /etc/cron.d/crosschex-sync ==="',
      `cat << 'EOF' > /etc/cron.d/crosschex-sync
# Sincronización automática periódica CrossChex (10.0.0.89 -> 10.0.0.10)
*/15 * * * * root /usr/bin/python3 ${REMOTE_MODULE_DIR}/backend/src/scripts/sync_crosschex_linux.py >> /var/log/crosschex-sync.log 2>&1
EOF`,
      'chmod 644 /etc/cron.d/crosschex-sync',

      'echo "=== 4. PROBAR EJECUCIÓN DE SINCRONIZACIÓN (--force) ==="',
      `/usr/bin/python3 ${REMOTE_MODULE_DIR}/backend/src/scripts/sync_crosschex_linux.py --force`,

      'echo "=== 5. REINICIAR SERVICIO BACKEND ==="',
      'systemctl restart control-acceso-backend',
      'sleep 3',
      'systemctl is-active control-acceso-backend',
      'curl -s http://127.0.0.1:3005/api/health',
      'echo ""'
    ].join(' && ');

    console.log('⚙️ Ejecutando configuración y prueba de sincronización en 10.0.0.10...');
    conn.exec(`echo "Sistemas" | sudo -S bash -c '${COMMANDS}'`, (execErr, stream) => {
      if (execErr) {
        console.error('❌ Error en ejecución remota:', execErr);
        conn.end();
        return;
      }

      stream.on('close', (code) => {
        console.log(`\n🏁 Proceso de configuración y sincronización finalizado con código: ${code}`);
        conn.end();
      });

      stream.on('data', (d) => process.stdout.write(d.toString()));
      stream.stderr.on('data', (d) => {
        const s = d.toString();
        if (!s.includes('[sudo]')) process.stderr.write(s);
      });
    });
  }
}).on('error', (err) => {
  console.error('❌ Error SSH:', err.message);
}).connect({
  host: '10.0.0.10',
  port: 22,
  username: 'admin-irg',
  password: 'Sistemas',
  readyTimeout: 15000
});
