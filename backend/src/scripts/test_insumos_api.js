import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `curl -s -H "Host: 10.0.0.10" http://127.0.0.1/irg-portal/modules/insumos/api/inventory`;
  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString().slice(0, 300)));
    stream.on('close', () => conn.end());
  });
}).connect({ host: '10.0.0.10', port: 22, username: 'admin-irg', password: 'Sistemas' });
