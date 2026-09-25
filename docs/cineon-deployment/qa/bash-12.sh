sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-cineon
sudo cp /opt/cineon/kit/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
curl -I https://cineon.me
curl -I https://www.cineon.me
