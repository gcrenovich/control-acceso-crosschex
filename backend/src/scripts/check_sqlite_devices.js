import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `
    sqlite3 /home/admin-irg/sistemas/irg-portal/modules/dashboard_it/backend/dashboard.db "SELECT count(*) FROM mac_history; SELECT ip, mac FROM mac_history LIMIT 10;"
  `;
  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.on('close', () => conn.end());
  });
}).connect({ host: '10.0.0.10', port: 22, username: 'admin-irg', password: 'Sistemas' });
