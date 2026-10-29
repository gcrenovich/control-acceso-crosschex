import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `node -e '
    const db = require("/home/admin-irg/sistemas/irg-portal/modules/dashboard_it/backend/database.js");
    db.all("SELECT count(*) as c FROM mac_history", [], (e, r) => console.log("MAC count:", r));
    db.all("SELECT ip, mac FROM mac_history LIMIT 10", [], (e, r) => {
      console.log("Sample devices:", r);
      process.exit(0);
    });
  '`;
  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.on('close', () => conn.end());
  });
}).connect({ host: '10.0.0.10', port: 22, username: 'admin-irg', password: 'Sistemas' });
