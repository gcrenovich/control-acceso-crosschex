import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `
    ping -c 1 -W 1 10.0.0.2 2>&1
    ping -c 1 -W 1 110.0.0.1 2>&1 || echo "110.0.0.1 no responde"
    ping -c 1 -W 1 10.0.1.1 2>&1 || echo "10.0.1.1 no responde"
  `;
  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.on('close', () => conn.end());
  });
}).connect({ host: '10.0.0.10', port: 22, username: 'admin-irg', password: 'Sistemas' });
