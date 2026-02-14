# GitHub Actions - Auto Deploy Setup

## 📋 Required GitHub Secrets

Vào GitHub Repository → Settings → Secrets and variables → Actions → New repository secret

### 1. Docker Hub Credentials
```
DOCKER_USERNAME = minhancr123
DOCKER_PASSWORD = your-docker-hub-password-or-token
```

### 2. VPS Credentials
```
VPS_HOST = your-vps-ip-address (e.g., 192.168.1.100)
VPS_USERNAME = root
VPS_PORT = 22
VPS_SSH_KEY = (paste your private SSH key)
```

### 3. Telegram Notification (Optional)
```
TELEGRAM_BOT_TOKEN = your-telegram-bot-token
TELEGRAM_CHAT_ID = your-telegram-chat-id
```

---

## 🔑 How to Get SSH Key

### On Windows (PowerShell):
```powershell
# Generate SSH key pair
ssh-keygen -t rsa -b 4096 -C "github-actions@movieweb"

# Copy private key content
Get-Content ~/.ssh/id_rsa | clip
```

### On Linux/Mac:
```bash
# Generate SSH key pair
ssh-keygen -t rsa -b 4096 -C "github-actions@movieweb"

# Copy private key content
cat ~/.ssh/id_rsa
```

### Add Public Key to VPS:
```bash
# On your VPS
mkdir -p ~/.ssh
nano ~/.ssh/authorized_keys

# Paste public key content from:
# Windows: type %USERPROFILE%\.ssh\id_rsa.pub
# Linux/Mac: cat ~/.ssh/id_rsa.pub

# Set permissions
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

---

## 🚀 How It Works

### Trigger Conditions:
GitHub Actions will automatically deploy when you:
- Push to `main` or `master` branch
- Change files in:
  - `backend/**` (C# Backend)
  - `backend-node/**` (Node.js Backend)
  - `docker-compose.prod.yml`
  - `.github/workflows/deploy.yml`

### Deployment Process:
1. ✅ Build Docker images for Node.js and C# backends
2. ✅ Push images to Docker Hub
3. ✅ SSH into VPS
4. ✅ Pull latest code from GitHub
5. ✅ Pull latest Docker images
6. ✅ Restart services with zero-downtime
7. ✅ Run health checks
8. ✅ Clean up old images
9. ✅ Send Telegram notification

### Zero-Downtime Deployment:
- Uses `--force-recreate --no-deps` to recreate only changed services
- Redis and other services stay running
- Health checks ensure services are working before completing

---

## 📱 Setup Telegram Notifications (Optional)

### 1. Create Telegram Bot:
1. Open Telegram and search for `@BotFather`
2. Send `/newbot`
3. Follow instructions to create bot
4. Copy the **Bot Token**

### 2. Get Chat ID:
1. Start a chat with your bot
2. Send any message
3. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Copy the `chat.id` value

### 3. Add to GitHub Secrets:
```
TELEGRAM_BOT_TOKEN = 1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID = 987654321
```

---

## 🧪 Test Deployment

### Manual Trigger (if enabled):
```bash
# Go to GitHub Repository
Actions → Deploy to VPS → Run workflow
```

### Push Code:
```bash
# Make a change
echo "# Test deployment" >> README.md

# Commit and push
git add .
git commit -m "Test auto deployment"
git push origin main

# Check GitHub Actions tab to see progress
```

---

## 🔍 Monitoring Deployment

### View Logs:
1. Go to GitHub Repository
2. Click **Actions** tab
3. Select the latest workflow run
4. Click **Deploy to VPS** job
5. View detailed logs

### On VPS:
```bash
# Check running containers
docker ps

# View logs
docker-compose logs -f backend-node
docker-compose logs -f backend-csharp

# Check health
curl http://localhost:5001/health
curl http://localhost:5291/health
```

---

## ⚠️ Important Notes

1. **First-time Setup:**
   - Make sure `/var/www/movieweb` directory exists on VPS
   - Clone repository manually first time: `git clone https://github.com/minhancr123/movie_web.git /var/www/movieweb`
   - Create `.env` file with production values

2. **Security:**
   - Never commit `.env` files
   - Use GitHub Secrets for sensitive data
   - Rotate SSH keys regularly

3. **Rollback:**
   If deployment fails:
   ```bash
   # On VPS
   cd /var/www/movieweb
   git checkout HEAD~1
   docker-compose -f docker-compose.prod.yml up -d
   ```

---

## 📊 Deployment Status Badge

Add to your README.md:
```markdown
![Deploy Status](https://github.com/minhancr123/movie_web/actions/workflows/deploy.yml/badge.svg)
```

---

## 🆘 Troubleshooting

### Deployment Failed?
1. Check GitHub Actions logs
2. Verify GitHub Secrets are correct
3. Test SSH connection manually:
   ```bash
   ssh -i ~/.ssh/id_rsa root@your-vps-ip
   ```
4. Check VPS logs:
   ```bash
   docker-compose logs --tail=100
   ```

### Health Check Failed?
1. SSH into VPS
2. Check container status: `docker ps`
3. View logs: `docker-compose logs backend-node backend-csharp`
4. Manually test health endpoints

---

## ✅ Setup Checklist

- [ ] Add `DOCKER_USERNAME` secret
- [ ] Add `DOCKER_PASSWORD` secret
- [ ] Generate SSH key pair
- [ ] Add public key to VPS `~/.ssh/authorized_keys`
- [ ] Add `VPS_HOST` secret
- [ ] Add `VPS_USERNAME` secret
- [ ] Add `VPS_PORT` secret (usually 22)
- [ ] Add `VPS_SSH_KEY` secret (private key)
- [ ] (Optional) Setup Telegram bot
- [ ] (Optional) Add `TELEGRAM_BOT_TOKEN` secret
- [ ] (Optional) Add `TELEGRAM_CHAT_ID` secret
- [ ] Clone repo to VPS `/var/www/movieweb`
- [ ] Create `.env` file on VPS
- [ ] Test manual push to trigger deployment
