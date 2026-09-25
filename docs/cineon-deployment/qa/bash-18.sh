cd /opt/cineon
cp previous.env current.env
cp compose.previous.yml compose.cineon.yml
dc up -d --wait --wait-timeout 180
bash kit/smoke.sh https://cineon.me
dc ps
