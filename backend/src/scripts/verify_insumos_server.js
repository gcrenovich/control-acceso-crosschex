import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `
    echo "--- Test Backend Insumos (3002) ---"
    curl -s http://127.0.0.1:3002/
    echo ""
    echo "--- Test HTTP Status index.php ---"
    curl -s -I http://localhost/irg-portal/modules/insumos/index.php
    echo ""
    echo "--- Test API proxy via PHP ---"
    curl -s "http://localhost/irg-portal/modules/insumos/api.php?_endpoint="
    echo ""
  `;
  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.on('close', () => conn.end());
  });
}).connect({ host: '10.0.0.10', port: 22, username: 'admin-irg', password: 'Sistemas' });
