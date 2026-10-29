import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `echo "Sistemas" | sudo -S bash -c '
    systemctl status insumos-backend.service irg-insumos.service --no-pager -l
    echo "--- insumos-backend.service ---"
    cat /etc/systemd/system/insumos-backend.service 2>/dev/null || true
    echo "--- irg-insumos.service ---"
    cat /etc/systemd/system/irg-insumos.service 2>/dev/null || true
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
