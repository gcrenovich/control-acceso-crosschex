import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_DATA_DIR = path.resolve(__dirname, '../../data');
const LOCAL_MDB_PATH = 'C:/CrossChex_Replicas/CrossChex_Local.mdb';
const REMOTE_TMP_DIR = '/tmp/crosschex_data_sync';
const REMOTE_PORTAL_BASE = '/home/admin-irg/sistemas/irg-portal';
const REMOTE_MODULE_BASE = `${REMOTE_PORTAL_BASE}/modules/control_acceso`;
const REMOTE_DEST_DIR = `${REMOTE_MODULE_BASE}/backend/data`;
const REMOTE_DB_DIR = `${REMOTE_MODULE_BASE}/db`;

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

export async function syncToServer(options = {}) {
  const forceMdb = options.forceMdb || process.argv.includes('--force-mdb');
  console.log('🚀 Iniciando sincronización integral con servidor Ubuntu (10.0.0.10)...');

  const filesToUpload = filesToSync.filter(f => {
    const fullPath = path.join(LOCAL_DATA_DIR, f);
    return fs.existsSync(fullPath);
  });

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
        // 1. Crear directorios necesarios en el servidor
        await execPromise(`mkdir -p ${REMOTE_TMP_DIR} ${REMOTE_DB_DIR}`);

        // 2. Subir archivos de datos y réplica de base de datos vía SFTP
        await new Promise((res, rej) => {
          conn.sftp(async (sftpErr, sftp) => {
            if (sftpErr) return rej(sftpErr);

            // A. Subir dataset procesado (CSV y JSON)
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

            // B. Subir Réplica de Base de Datos (.mdb)
            if (fs.existsSync(LOCAL_MDB_PATH)) {
              const mdbStats = fs.statSync(LOCAL_MDB_PATH);
              const mdbMb = (mdbStats.size / (1024 * 1024)).toFixed(2);
              let uploadMdb = true;

              if (!forceMdb) {
                try {
                  const remoteStat = await new Promise((statRes) => {
                    sftp.stat(`${REMOTE_DEST_DIR}/CrossChex_Local.mdb`, (err, stat) => {
                      statRes(err ? null : stat);
                    });
                  });
                  if (remoteStat && remoteStat.size === mdbStats.size) {
                    // Si el tamaño coincide exactamente y no se forzó, verificar si cambió
                    const remoteMtime = remoteStat.mtime;
                    const localMtime = Math.floor(mdbStats.mtimeMs / 1000);
                    if (Math.abs(remoteMtime - localMtime) <= 10) {
                      uploadMdb = false;
                      console.log(`💾 Réplica de Base de Datos CrossChex_Local.mdb (${mdbMb} MB) ya está al día en el servidor.`);
                    }
                  }
                } catch (statErr) {
                  uploadMdb = true;
                }
              }

              if (uploadMdb) {
                process.stdout.write(`💾 Subiendo RÉPLICA DE BASE DE DATOS (${mdbMb} MB: CrossChex_Local.mdb)... `);
                const mdbStartTime = Date.now();
                const remoteTmpMdb = `${REMOTE_TMP_DIR}/CrossChex_Local.mdb`;

                await new Promise((putRes, putRej) => {
                  sftp.fastPut(LOCAL_MDB_PATH, remoteTmpMdb, { concurrency: 64 }, (err) => {
                    if (err) putRej(err);
                    else {
                      const elapsed = ((Date.now() - mdbStartTime) / 1000).toFixed(1);
                      console.log(`¡OK! (${elapsed}s)`);
                      putRes();
                    }
                  });
                });
              }
            } else {
              console.log('⚠️ No se encontró réplica local en', LOCAL_MDB_PATH);
            }

            res();
          });
        });

        // 3. Mover archivos a producción, enlazar réplica MDB y recargar memoria
        console.log('⚙️ Moviendo archivos a producción y actualizando enlaces...');
        const finishCmd = `
echo "Sistemas" | sudo -S bash -c '
set -e
# Mover archivos de datos
cp -r ${REMOTE_TMP_DIR}/* ${REMOTE_DEST_DIR}/

# Crear enlaces y copias de la réplica de base de datos en el servidor
if [ -f "${REMOTE_DEST_DIR}/CrossChex_Local.mdb" ]; then
    cp -p "${REMOTE_DEST_DIR}/CrossChex_Local.mdb" "${REMOTE_DEST_DIR}/CrossChex.mdb" 2>/dev/null || true
    mkdir -p "${REMOTE_DB_DIR}"
    ln -sf "${REMOTE_DEST_DIR}/CrossChex_Local.mdb" "${REMOTE_DB_DIR}/CrossChex_Local.mdb"
    ln -sf "${REMOTE_DEST_DIR}/CrossChex_Local.mdb" "${REMOTE_DB_DIR}/CrossChex.mdb"
fi

# Ajustar permisos
chown -R admin-irg:www-data ${REMOTE_DEST_DIR} ${REMOTE_DB_DIR} ${REMOTE_MODULE_BASE}/backend/.env
chmod -R 775 ${REMOTE_DEST_DIR} ${REMOTE_DB_DIR}
rm -rf ${REMOTE_TMP_DIR}
'
# Solicitar recarga de dataset en memoria al backend
curl -s -X POST http://127.0.0.1:3005/api/sync -H "Content-Type: application/json" -H "x-api-key: mi_clave_secreta_crosschex_2026"
`;

        const reloadRes = await execPromise(finishCmd);
        console.log('Resultado del servidor:', reloadRes.out.trim());

        console.log('\n🎉 ¡Sincronización integral y réplica de BD en 10.0.0.10 completada!');
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
      readyTimeout: 20000
    });
  });
}

// Ejecutar si es llamado directamente
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncToServer().catch(() => process.exit(1));
}
