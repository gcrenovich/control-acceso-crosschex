import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_TAR = path.resolve(__dirname, '../../../deploy/control-acceso-crosschex.tar.gz');
const REMOTE_TAR = '/tmp/control-acceso-crosschex.tar.gz';

console.log('🚀 Iniciando despliegue hacia 10.0.0.10...');
console.log('📦 Archivo local:', LOCAL_TAR);

const conn = new Client();

conn.on('ready', () => {
  console.log('✅ Conexión SSH establecida con éxito.');

  // 1. Iniciar SFTP para transferir el archivo
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('❌ Error SFTP:', err);
      conn.end();
      return;
    }

    const stats = fs.statSync(LOCAL_TAR);
    const totalSize = stats.size;
    console.log(`📤 Transfiriendo paquete (${(totalSize / (1024 * 1024)).toFixed(2)} MB)...`);

    let lastLogged = 0;
    const readStream = fs.createReadStream(LOCAL_TAR);
    const writeStream = sftp.createWriteStream(REMOTE_TAR);

    let transferred = 0;
    readStream.on('data', (chunk) => {
      transferred += chunk.length;
      const pct = Math.floor((transferred / totalSize) * 100);
      if (pct >= lastLogged + 20 || pct === 100) {
        lastLogged = pct;
        console.log(`   Progreso: ${pct}% (${(transferred / (1024 * 1024)).toFixed(2)} MB / ${(totalSize / (1024 * 1024)).toFixed(2)} MB)`);
      }
    });

    writeStream.on('close', () => {
      console.log('✅ Paquete transferido exitosamente a /tmp/control-acceso-crosschex.tar.gz');

      // 2. Ejecutar extracción e instalación mediante sudo
      const deployCmd = `
echo "Sistemas" | sudo -S bash -c '
set -e
echo "==> Descomprimiendo paquete..."
rm -rf /tmp/crosschex
mkdir -p /tmp/crosschex
tar -xzf /tmp/control-acceso-crosschex.tar.gz -C /tmp/crosschex
cd /tmp/crosschex
echo "==> Ejecutando instalador..."
bash deploy/instalar_servidor.sh
echo "==> Limpieza de temporales..."
rm -rf /tmp/crosschex /tmp/control-acceso-crosschex.tar.gz
'
`;

      console.log('⚙️ Ejecutando instalador en el servidor con permisos sudo...');
      conn.exec(deployCmd, (execErr, stream) => {
        if (execErr) {
          console.error('❌ Error al ejecutar instalación:', execErr);
          conn.end();
          return;
        }

        stream.on('close', (code, signal) => {
          console.log(`\n🏁 Proceso de instalación finalizado con código: ${code}`);

          // 3. Verificación final de salud del servicio
          conn.exec('curl -s http://127.0.0.1:3005/api/health && echo "" && systemctl is-active control-acceso-backend && systemctl is-active apache2', (vErr, vStream) => {
            if (!vErr) {
              vStream.on('data', (d) => process.stdout.write(d));
              vStream.on('close', () => {
                console.log('\n🎉 ¡Despliegue verificado y completado!');
                conn.end();
              });
            } else {
              conn.end();
            }
          });
        });

        stream.on('data', (data) => {
          process.stdout.write(data);
        });

        stream.stderr.on('data', (data) => {
          // Filtrar el prompt de sudo para no ensuciar el log
          const text = data.toString();
          if (!text.includes('[sudo]')) {
            process.stderr.write(data);
          }
        });
      });
    });

    readStream.pipe(writeStream);
  });
}).on('error', (err) => {
  console.error('❌ Error de conexión:', err.message);
}).connect({
  host: '10.0.0.10',
  port: 22,
  username: 'admin-irg',
  password: 'Sistemas',
  readyTimeout: 20000
});
