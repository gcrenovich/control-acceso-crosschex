import { Client } from 'ssh2';

const conn = new Client();

conn.on('ready', () => {
  const cmd = `
    cat /home/admin-irg/sistemas/irg-portal/admin/permisos_sectores.php | grep -E "(sistemas_disponibles|sistemas)" -A 10 | head -n 30
  `;
  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', (data) => process.stdout.write(data));
    stream.on('close', () => {
      conn.end();
    });
  });
}).on('error', (err) => {
  console.error('SSH Error:', err);
}).connect({
  host: '10.0.0.10',
  port: 22,
  username: 'admin-irg',
  password: 'Sistemas',
  readyTimeout: 10000
});
