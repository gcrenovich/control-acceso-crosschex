import { Client } from 'ssh2';

const c = new Client();
c.on('ready', () => {
  const cmd = `echo "Sistemas" | sudo -S cat /etc/netplan/50-cloud-init.yaml`;
  c.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.on('close', () => c.end());
  });
}).connect({ host: '10.0.0.10', port: 22, username: 'admin-irg', password: 'Sistemas' });
