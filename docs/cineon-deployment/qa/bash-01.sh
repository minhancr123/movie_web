cat /etc/os-release
free -h
df -h /
sudo ss -lntup
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git unzip \
  ufw htop sysstat dnsutils openssl
sudo adduser deploy
sudo usermod -aG sudo deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
sudo nano /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
