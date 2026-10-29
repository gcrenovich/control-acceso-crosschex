import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `echo "Sistemas" | sudo -S bash -c '
    systemctl status dashboard-it.service irg-dashboard-it.service --no-pager -l
    echo "--- dashboard-it.service ---"
    cat /etc/systemd/system/dashboard-it.service 2>/dev/null || true
    echo "--- irg-dashboard-it.service ---"
    cat /etc/systemd/system/irg-dashboard-it.service 2>/dev/null || true
    echo "--- journalctl dashboard-it ---"
    journalctl -u irg-dashboard-it -u dashboard-it -n 30 --no-pager
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
