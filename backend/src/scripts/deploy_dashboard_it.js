import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';

const conn = new Client();

const localBackendDir = 'C:/xampp/htdocs/irg-portal/modules/dashboard_it/backend';
const localDistDir = 'C:/xampp/htdocs/irg-portal/modules/dashboard_it/frontend/dist';

const remoteBasePath = '/home/admin-irg/sistemas/irg-portal/modules/dashboard_it';
const remoteBackendDir = `${remoteBasePath}/backend`;
const remoteDistDir = `${remoteBasePath}/frontend/dist`;

function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);
  files.forEach(file => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  });
  return arrayOfFiles;
}

const execPromise = (cmd) => {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('data', d => { out += d; process.stdout.write(d.toString()); });
      stream.stderr.on('data', d => {
        const s = d.toString();
        if (!s.includes('[sudo]')) process.stderr.write(s);
      });
      stream.on('close', (code) => {
        resolve({ code, out });
      });
    });
  });
};

conn.on('ready', async () => {
  console.log('✅ SSH conectado a 10.0.0.10');

  try {
    console.log('📁 Creando directorios remotos necesarios...');
    await execPromise(`mkdir -p "${remoteBackendDir}" "${remoteDistDir}/assets"`);

    console.log('🔌 Abriendo SFTP...');
    await new Promise((resolve, reject) => {
      conn.sftp(async (err, sftp) => {
        if (err) return reject(err);

        try {
          // 1. Subir backend
          const backendFiles = ['server.js', 'database.js'];
          for (const bf of backendFiles) {
            const loc = path.join(localBackendDir, bf);
            const rem = `${remoteBackendDir}/${bf}`;
            console.log(`📤 Subiendo backend: ${bf}...`);
            await new Promise((res, rej) => {
              sftp.fastPut(loc, rem, (pErr) => {
                if (pErr) rej(pErr);
                else {
                  console.log(`   ✅ ${bf} subido.`);
                  res();
                }
              });
            });
          }

          // 2. Subir frontend dist
          const distFiles = getAllFiles(localDistDir);
          for (const f of distFiles) {
            const rel = path.relative(localDistDir, f).replace(/\\/g, '/');
            const rem = `${remoteDistDir}/${rel}`;
            console.log(`📤 Subiendo dist: ${rel}...`);
            await new Promise((res, rej) => {
              sftp.fastPut(f, rem, (pErr) => {
                if (pErr) rej(pErr);
                else {
                  console.log(`   ✅ ${rel} subido.`);
                  res();
                }
              });
            });
          }

          resolve();
        } catch (uploadErr) {
          reject(uploadErr);
        }
      });
    });

    console.log('🚀 Reiniciando servicio irg-dashboard-it.service...');
    await execPromise(`echo "Sistemas" | sudo -S bash -c '
      systemctl restart irg-dashboard-it.service
      sleep 2
      systemctl status irg-dashboard-it.service --no-pager
      echo "=== Subredes API Test ==="
      curl -s http://localhost:3001/api/subredes
      echo ""
      echo "=== Dispositivos Seed Test ==="
      curl -s http://localhost:3001/api/dispositivos_custom || true
      echo ""
    '`);

    console.log('🎉 Despliegue completado con éxito!');
    conn.end();
  } catch (error) {
    console.error('❌ Error en el despliegue:', error);
    conn.end();
  }
}).connect({ host: '10.0.0.10', port: 22, username: 'admin-irg', password: 'Sistemas' });
