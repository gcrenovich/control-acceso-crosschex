import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `echo "Sistemas" | sudo -S bash -c '
    systemctl stop dashboard-it.service 2>/dev/null || true
    systemctl disable dashboard-it.service 2>/dev/null || true
    chown -R admin-irg:www-data /home/admin-irg/sistemas/irg-portal/modules/dashboard_it
    chmod -R 775 /home/admin-irg/sistemas/irg-portal/modules/dashboard_it
    systemctl restart irg-dashboard-it.service
    sleep 2
    systemctl status irg-dashboard-it.service --no-pager -l
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
