import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `
    echo "--- modules/dashboard_it contents ---"
    ls -la /home/admin-irg/sistemas/irg-portal/modules/dashboard_it
    echo "--- backend contents ---"
    ls -la /home/admin-irg/sistemas/irg-portal/modules/dashboard_it/backend 2>/dev/null || echo "No backend dir"
    echo "--- systemd services for dashboard ---"
    systemctl list-unit-files | grep -i dashboard || true
    echo "--- pm2 list ---"
    pm2 list 2>/dev/null || true
  `;
  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.on('close', () => conn.end());
  });
}).connect({ host: '10.0.0.10', port: 22, username: 'admin-irg', password: 'Sistemas' });
