import { Client } from 'ssh2';

const conn = new Client();

const COMMANDS = [
  'cat /etc/cron.d/crosschex-sync',
  'ls -lh /etc/crosschex-credentials',
  'tail -n 25 /var/log/crosschex-sync.log 2>/dev/null || echo "Log aun vacio (el cron corre cada 15 min)"'
].join(' && ');

conn.on('ready', () => {
  conn.exec(`echo "Sistemas" | sudo -S bash -c '${COMMANDS}'`, (err, stream) => {
    if (err) {
      console.error('Error:', err);
      conn.end();
      return;
    }

    stream.on('close', (code) => {
      conn.end();
    });

    stream.on('data', (d) => process.stdout.write(d.toString()));
    stream.stderr.on('data', (d) => {
      const s = d.toString();
      if (!s.includes('[sudo]')) process.stderr.write(s);
    });
  });
}).on('error', (err) => {
  console.error('Error:', err);
}).connect({
  host: '10.0.0.10',
  port: 22,
  username: 'admin-irg',
  password: 'Sistemas',
  readyTimeout: 10000
});
