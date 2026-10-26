import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_DATA_DIR = path.resolve(__dirname, '../../data');
const REMOTE_TMP_DIR = '/tmp/crosschex_data_sync';
const REMOTE_DEST_DIR = '/var/www/control-acceso-crosschex/backend/data';

const filesToSync = [
  'departments.json',
  'users.json',
  'timetables.json',
  'schedules.json',
  'sch_times.json',
  'user_shifts.json',
  'user_temp_shifts.csv',
  'leave_classes.json',
  'user_leaves.json',
  'devices.json',
  'holidays.json',
  'crosschex_holidays.json',
  'checkinout.csv'
];

export async function syncToServer() {
  console.log('🚀 Iniciando sincronización de datos con servidor Ubuntu (10.0.0.10)...');

  const filesToUpload = filesToSync.filter(f => {
    const fullPath = path.join(LOCAL_DATA_DIR, f);
    return fs.existsSync(fullPath);
  });

  if (filesToUpload.length === 0) {
    console.error('❌ No hay archivos en', LOCAL_DATA_DIR, 'para sincronizar.');
    return;
  }

  const conn = new Client();

  return new Promise((resolve, reject) => {
    conn.on('ready', async () => {
      console.log('✅ SSH conectado con éxito a 10.0.0.10.');

      const execPromise = (cmd) => {
        return new Promise((res, rej) => {
          conn.exec(cmd, (err, stream) => {
            if (err) return rej(err);
            let out = '';
            stream.on('data', d => { out += d.toString(); });
            stream.stderr.on('data', d => { out += d.toString(); });
            stream.on('close', code => res({ code, out }));
          });
        });
      };

      try {
        // 1. Crear directorio temporal en el servidor
        await execPromise(`mkdir -p ${REMOTE_TMP_DIR}`);
        console.log('📁 Carpeta temporal creada en el servidor.');

        // 2. Subir archivos vía SFTP
        await new Promise((res, rej) => {
          conn.sftp(async (sftpErr, sftp) => {
            if (sftpErr) return rej(sftpErr);

            for (let i = 0; i < filesToUpload.length; i++) {
              const file = filesToUpload[i];
              const localPath = path.join(LOCAL_DATA_DIR, file);
              const remotePath = `${REMOTE_TMP_DIR}/${file}`;
              const stats = fs.statSync(localPath);
              const mbSize = (stats.size / (1024 * 1024)).toFixed(2);

              process.stdout.write(`📤 [${i + 1}/${filesToUpload.length}] Subiendo ${file} (${mbSize} MB)... `);
              const startTime = Date.now();

              await new Promise((putRes, putRej) => {
                sftp.fastPut(localPath, remotePath, (err) => {
                  if (err) putRej(err);
                  else {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    console.log(`OK (${elapsed}s)`);
                    putRes();
                  }
                });
              });
            }
            res();
          });
        });

        // 3. Mover archivos al directorio de producción y recargar memoria
        console.log('⚙️ Moviendo archivos a producción y recargando backend...');
        const finishCmd = `
echo "Sistemas" | sudo -S bash -c '
set -e
cp -r ${REMOTE_TMP_DIR}/* ${REMOTE_DEST_DIR}/
chown -R www-data:www-data ${REMOTE_DEST_DIR}
chmod -R 775 ${REMOTE_DEST_DIR}
rm -rf ${REMOTE_TMP_DIR}
'
# Solicitar recarga de dataset en memoria
curl -s -X POST http://127.0.0.1:3005/api/sync -H "Content-Type: application/json" -H "x-api-key: mi_clave_secreta_crosschex_2026"
`;

        const reloadRes = await execPromise(finishCmd);
        console.log('Resultado del servidor:', reloadRes.out.trim());

        console.log('\n🎉 ¡Sincronización con el servidor 10.0.0.10 completada con éxito!');
        conn.end();
        resolve(true);
      } catch (err) {
        console.error('❌ Error durante la sincronización:', err);
        conn.end();
        reject(err);
      }
    }).on('error', (err) => {
      console.error('❌ Error de conexión SSH:', err.message);
      reject(err);
    }).connect({
      host: '10.0.0.10',
      port: 22,
      username: 'admin-irg',
      password: 'Sistemas',
      readyTimeout: 15000
    });
  });
}

// Ejecutar si es llamado directamente
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncToServer().catch(() => process.exit(1));
}
