sudo apt install -y debian-keyring debian-archive-keyring \
  apt-transport-https curl gnupg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | sudo gpg --dearmor \
    -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo chmod a+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo chmod a+r /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
