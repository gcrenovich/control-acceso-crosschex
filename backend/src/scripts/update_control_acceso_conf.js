import { Client } from 'ssh2';

const confContent = `<VirtualHost *:80>
    ServerName 10.0.0.10
    ServerAlias localhost 127.0.0.1 portal.sistemas.local portal.local

    # Redirección automática de la raíz hacia el portal principal
    RedirectMatch 302 ^/$ /irg-portal/

    # Portal institucional IRG
    Alias /irg-portal /home/admin-irg/sistemas/irg-portal
    <Directory /home/admin-irg/sistemas/irg-portal>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    <Directory /home/admin-irg/sistemas/irg-portal/modules/control_acceso/frontend/dist>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    <Directory /home/admin-irg/sistemas/irg-portal/modules/insumos/frontend/dist>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    # Proxy inverso para APIs de backend Node.js
    ProxyPreserveHost On
    ProxyRequests Off

    <Proxy *>
        Require all granted
    </Proxy>

    # Control de Acceso (Puerto 3005)
    ProxyPass /api http://127.0.0.1:3005/api
    ProxyPassReverse /api http://127.0.0.1:3005/api
    ProxyPass /irg-portal/modules/control_acceso/api http://127.0.0.1:3005/api
    ProxyPassReverse /irg-portal/modules/control_acceso/api http://127.0.0.1:3005/api

    # Gestión de Insumos (Puerto 3002)
    ProxyPass /irg-portal/modules/insumos/api http://127.0.0.1:3002/api
    ProxyPassReverse /irg-portal/modules/insumos/api http://127.0.0.1:3002/api

    LimitRequestBody 52428800

    ErrorLog \${APACHE_LOG_DIR}/portal-irg-error.log
    CustomLog \${APACHE_LOG_DIR}/portal-irg-access.log combined
</VirtualHost>
`;

const conn = new Client();
conn.on('ready', () => {
  const cmd = `echo "Sistemas" | sudo -S bash -c '
    cat << "EOF" > /etc/apache2/sites-available/control-acceso.conf
${confContent}
EOF
    apache2ctl configtest && systemctl reload apache2
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
