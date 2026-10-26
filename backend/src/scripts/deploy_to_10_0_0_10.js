import { Client } from 'ssh2';
import path from 'path';

const REMOTE_BASE = '/home/admin-irg/sistemas/irg-portal';
const LOCAL_BASE = 'C:/xampp/htdocs/irg-portal';

const filesToDeploy = [
  'admin/permisos_sectores.php',
  'config/session.php',
  'includes/sidebar.php',
  'index.php',
  'modules/control_acceso/index.php',
  'modules/git_manager/index.php'
];

console.log('🚀 Conectando a 10.0.0.10...');
const conn = new Client();

const execPromise = (cmd) => {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('data', d => { out += d; process.stdout.write(d); });
      stream.stderr.on('data', d => { process.stderr.write(d); });
      stream.on('close', (code) => {
        resolve({ code, out });
      });
    });
  });
};

conn.on('ready', async () => {
  console.log('✅ SSH conectado.');

  try {
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);

    console.log('📦 Creando carpetas y respaldos remotos...');
    const prepCmd = `
      mkdir -p ${REMOTE_BASE}/modules/control_acceso
      mkdir -p ${REMOTE_BASE}/modules/git_manager
      for f in admin/permisos_sectores.php config/session.php includes/sidebar.php index.php modules/control_acceso/index.php modules/git_manager/index.php; do
        if [ -f "${REMOTE_BASE}/$f" ]; then
          cp -p "${REMOTE_BASE}/$f" "${REMOTE_BASE}/$f.bak_${timestamp}"
        fi
      done
    `;
    await execPromise(prepCmd);
    console.log('✅ Respaldos completados.');

    await new Promise((resolve, reject) => {
      conn.sftp(async (err, sftp) => {
        if (err) return reject(err);

        for (const file of filesToDeploy) {
          const localPath = path.join(LOCAL_BASE, file);
          const remotePath = `${REMOTE_BASE}/${file}`.replace(/\\/g, '/');
          console.log(`📤 Subiendo ${file}...`);
          await new Promise((res, rej) => {
            sftp.fastPut(localPath, remotePath, (putErr) => {
              if (putErr) rej(putErr);
              else {
                console.log(`   ✅ ${file} subido.`);
                res();
              }
            });
          });
        }
        resolve();
      });
    });

    console.log('⚙️ Actualizando permisos JSON...');
    const updatePermisosCmd = `
echo "Sistemas" | sudo -S php -r '
  $f = "${REMOTE_BASE}/data/permisos_sectores.json";
  $data = json_decode(file_get_contents($f), true) ?: [];
  if (!isset($data["SISTEMAS"])) $data["SISTEMAS"] = [];
  if (!in_array("control_acceso", $data["SISTEMAS"])) $data["SISTEMAS"][] = "control_acceso";
  if (!in_array("git_manager", $data["SISTEMAS"])) $data["SISTEMAS"][] = "git_manager";
  if (!isset($data["Personal"])) $data["Personal"] = [];
  if (!in_array("control_acceso", $data["Personal"])) $data["Personal"][] = "control_acceso";
  if (!isset($data["Liquidacion"])) $data["Liquidacion"] = [];
  if (!in_array("control_acceso", $data["Liquidacion"])) $data["Liquidacion"][] = "control_acceso";
  if (!isset($data["Oficina_Personal"])) $data["Oficina_Personal"] = [];
  if (!in_array("control_acceso", $data["Oficina_Personal"])) $data["Oficina_Personal"][] = "control_acceso";
  file_put_contents($f, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
  echo "Permisos JSON actualizados con exito.\n";
'
`;
    await execPromise(updatePermisosCmd);

    console.log('🔒 Ajustando propietarios y permisos en servidor...');
    await execPromise(`echo "Sistemas" | sudo -S chown -R admin-irg:www-data ${REMOTE_BASE} && sudo chmod -R 775 ${REMOTE_BASE}/data`);

    console.log('🔍 Verificando sintaxis PHP remota...');
    const checkSyntaxCmd = `
      php -l ${REMOTE_BASE}/admin/permisos_sectores.php
      php -l ${REMOTE_BASE}/config/session.php
      php -l ${REMOTE_BASE}/includes/sidebar.php
      php -l ${REMOTE_BASE}/index.php
      php -l ${REMOTE_BASE}/modules/control_acceso/index.php
      php -l ${REMOTE_BASE}/modules/git_manager/index.php
    `;
    await execPromise(checkSyntaxCmd);

    console.log('\n🎉 ¡Despliegue completado con éxito hacia 10.0.0.10!');
    conn.end();
  } catch (e) {
    console.error('❌ Error:', e);
    conn.end();
  }
}).connect({
  host: '10.0.0.10',
  port: 22,
  username: 'admin-irg',
  password: 'Sistemas'
});
