cd /opt/cineon
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 700 backups
umask 077
tar -czf "backups/config-$STAMP.tgz" \
  .env.cineon current.env compose.cineon.yml
sudo cp /etc/caddy/Caddyfile "backups/Caddyfile-$STAMP"
sudo chown deploy:deploy "backups/Caddyfile-$STAMP"
chmod 600 "backups/Caddyfile-$STAMP"
