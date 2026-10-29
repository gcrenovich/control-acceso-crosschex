import { Client } from 'ssh2';

const c = new Client();
c.on('ready', () => {
  const newNetplan = `network:
  version: 2
  ethernets:
    enp0s25:
      addresses:
      - "10.0.0.10/24"
      - "110.0.0.10/24"
      nameservers:
        addresses:
        - 8.8.8.8
        - 1.1.1.1
        search: []
      routes:
      - to: "default"
        via: "10.0.0.2"
`;

  const cmd = `echo "Sistemas" | sudo -S bash -c '
    cp /etc/netplan/50-cloud-init.yaml /etc/netplan/50-cloud-init.yaml.bak
    cat << "EOF" > /etc/netplan/50-cloud-init.yaml
${newNetplan}EOF
    chmod 600 /etc/netplan/50-cloud-init.yaml
    netplan apply
    ip -br a show dev enp0s25
    ping -c 2 110.0.0.5
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
