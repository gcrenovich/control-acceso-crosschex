import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `echo "Sistemas" | sudo -S bash -c '
    cd /home/admin-irg/sistemas/irg-portal/modules/dashboard_it/backend
    rm -rf node_modules/sqlite3
    npm install sqlite3
    node -e "const s = require(\\"sqlite3\\"); console.log(\\"SQLite3 OK!\\");"
  '`;
  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => {
      const s = d.toString();
      if (!s.includes('[sudo]')) process.stderr.write(s);
    });
    stream.on('close', () => conn.end());
  });
}).connect({ host: '10.0.0.10', port: 22, username: 'admin-irg', password: 'Sistemas' });
