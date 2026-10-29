import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `echo "Sistemas" | sudo -S bash -c 'ss -tulpn | grep 300; systemctl list-unit-files | grep -E "insumo|portal|node|crosschex"; docker ps 2>/dev/null || true'`;
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
