import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `
    echo "--- arp -a test ---"
    arp -a 2>&1 | head -n 10
    echo "--- ip neigh test ---"
    ip neigh 2>&1 | head -n 10
    echo "--- test curl 3001 ---"
    curl -s http://127.0.0.1:3001/api/tareas | head -c 200
    echo ""
  `;
  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.on('close', () => conn.end());
  });
}).connect({ host: '10.0.0.10', port: 22, username: 'admin-irg', password: 'Sistemas' });
