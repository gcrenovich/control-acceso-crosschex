import { Client } from 'ssh2';

const conn = new Client();

conn.on('ready', () => {
  conn.exec('php -l /home/admin-irg/sistemas/irg-portal/config/session.php', (err, stream) => {
    if (err) throw err;
    stream.on('data', (d) => process.stdout.write(d));
    stream.on('close', () => conn.end());
  });
}).connect({
  host: '10.0.0.10',
  port: 22,
  username: 'admin-irg',
  password: 'Sistemas'
});
