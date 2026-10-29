import { Client } from 'ssh2';

const c = new Client();
c.on('ready', () => {
  const cmd = `echo "Sistemas" | sudo -S bash -c '
    ip addr add 110.0.0.10/24 dev enp0s25 2>/dev/null || true
    ip -br a show dev enp0s25
    echo "--- Pinging 110.0.0.5 from 10.0.0.10 ---"
    ping -c 3 110.0.0.5
    echo "--- ARP for 110.0.0.5 ---"
    ip neigh show 110.0.0.5
  '`;
  c.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => {
      const s = d.toString();
      if (!s.includes('[sudo]')) process.stderr.write(s);
    });
    stream.on('close', () => c.end());
  });
}).connect({ host: '10.0.0.10', port: 22, username: 'admin-irg', password: 'Sistemas' });
