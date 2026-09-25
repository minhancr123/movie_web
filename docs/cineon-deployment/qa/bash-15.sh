cd /opt/cineon
cp current.env previous.env
cp compose.cineon.yml compose.previous.yml
cp .env.cineon .env.previous
chmod 600 previous.env .env.previous
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.previous
cp kit/release.env.example next.env
nano next.env
