import { Client } from 'ssh2';

const conn = new Client();

conn.on('ready', () => {
  const cmd = `
    echo "=== permisos_sectores.json ==="
    cat /home/admin-irg/sistemas/irg-portal/data/permisos_sectores.json 2>/dev/null || true
    echo "=== usuarios roles en DB ==="
    cat /home/admin-irg/sistemas/irg-portal/data/sectores.json 2>/dev/null || true
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
