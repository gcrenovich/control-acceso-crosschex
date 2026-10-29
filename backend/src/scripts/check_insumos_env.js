import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `cat /home/admin-irg/sistemas/irg-portal/modules/insumos/backend/.env 2>/dev/null || echo "No .env"`;
  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.on('close', () => conn.end());
  });
}).connect({ host: '10.0.0.10', port: 22, username: 'admin-irg', password: 'Sistemas' });
