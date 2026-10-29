import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = `echo "Sistemas" | sudo -S bash -c '
    grep -rn "ProxyPass" /etc/apache2/
    echo "--- sites-enabled ---"
    ls -la /etc/apache2/sites-enabled/
    echo "--- All enabled site configs ---"
    head -n 50 /etc/apache2/sites-enabled/*
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
