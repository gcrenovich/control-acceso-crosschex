import { Client } from 'ssh2';
import path from 'path';
import fs from 'fs';

const LOCAL_MODULE = 'C:/xampp/htdocs/irg-portal/modules/insumos';
const REMOTE_MODULE = '/home/admin-irg/sistemas/irg-portal/modules/insumos';

const conn = new Client();

const execPromise = (cmd) => {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('data', d => { out += d; process.stdout.write(d.toString()); });
      stream.stderr.on('data', d => { process.stderr.write(d.toString()); });
      stream.on('close', (code) => {
        resolve({ code, out });
      });
    });
  });
};

function getFilesRecursively(dir, baseDir = dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file === 'node_modules' || file === '.git') continue;
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      results = results.concat(getFilesRecursively(filePath, baseDir));
    } else {
      results.push(path.relative(baseDir, filePath));
    }
  }
  return results;
}

conn.on('ready', async () => {
  console.log('✅ SSH conectado a 10.0.0.10.');

  try {
    console.log('📁 Recolectando archivos locales de insumos...');
    // We want index.php, api.php, backend/src, backend/package.json, frontend/dist
    const filesToUpload = [
      'index.php',
      'api.php',
      'backend/package.json',
      'backend/package-lock.json',
      ...getFilesRecursively(path.join(LOCAL_MODULE, 'backend', 'src'), LOCAL_MODULE),
      ...getFilesRecursively(path.join(LOCAL_MODULE, 'frontend', 'dist'), LOCAL_MODULE)
    ];

    console.log(`📦 Total archivos a desplegar: ${filesToUpload.length}`);

    await new Promise((resolve, reject) => {
      conn.sftp(async (err, sftp) => {
        if (err) return reject(err);

        // Ensure remote directories exist
        const dirs = new Set();
        for (const file of filesToUpload) {
          const dir = path.dirname(file).replace(/\\/g, '/');
          if (dir !== '.') {
            const parts = dir.split('/');
            let current = '';
            for (const part of parts) {
              current = current ? `${current}/${part}` : part;
              dirs.add(current);
            }
          }
        }

        const sortedDirs = Array.from(dirs).sort((a, b) => a.length - b.length);
        for (const d of sortedDirs) {
          const remoteDir = `${REMOTE_MODULE}/${d}`;
          await execPromise(`mkdir -p "${remoteDir}"`);
        }

        for (const file of filesToUpload) {
          const localPath = path.join(LOCAL_MODULE, file);
          const remotePath = `${REMOTE_MODULE}/${file}`.replace(/\\/g, '/');
          console.log(`📤 Subiendo: ${file}`);
          await new Promise((res, rej) => {
            sftp.fastPut(localPath, remotePath, (putErr) => {
              if (putErr) rej(putErr);
              else res();
            });
          });
        }
        resolve();
      });
    });

    console.log('🔒 Ajustando propietarios y permisos...');
    await execPromise(`echo "Sistemas" | sudo -S chown -R admin-irg:www-data "${REMOTE_MODULE}"`);
    await execPromise(`echo "Sistemas" | sudo -S chmod -R 775 "${REMOTE_MODULE}"`);

    console.log('🔍 Verificando sintaxis PHP...');
    await execPromise(`php -l "${REMOTE_MODULE}/index.php"`);
    await execPromise(`php -l "${REMOTE_MODULE}/api.php"`);

    console.log('⚙️ Configurando servicios de Insumos...');
    // Disable duplicate insumos-backend and use irg-insumos
    await execPromise(`echo "Sistemas" | sudo -S systemctl stop insumos-backend.service 2>/dev/null || true`);
    await execPromise(`echo "Sistemas" | sudo -S systemctl disable insumos-backend.service 2>/dev/null || true`);
    await execPromise(`echo "Sistemas" | sudo -S systemctl restart irg-insumos.service`);
    await execPromise(`echo "Sistemas" | sudo -S systemctl status irg-insumos.service --no-pager`);

    console.log('🔄 Recargando Apache...');
    await execPromise(`echo "Sistemas" | sudo -S systemctl reload apache2`);

    console.log('\n🎉 ¡Módulo Insumos desplegado y funcionando en 10.0.0.10!');
    conn.end();
  } catch (e) {
    console.error('❌ Error en despliegue:', e);
    conn.end();
  }
}).connect({
  host: '10.0.0.10',
  port: 22,
  username: 'admin-irg',
  password: 'Sistemas'
});
