import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `
    echo "--- ip addr ---"
    ip -4 addr show
    echo "--- ip route ---"
    ip route show
    echo "--- arp / ip neigh summary ---"
    ip neigh | cut -d' ' -f1 | cut -d'.' -f1-3 | sort | uniq -c
  `;
  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.on('close', () => conn.end());
  });
}).connect({ host: '10.0.0.10', port: 22, username: 'admin-irg', password: 'Sistemas' });
