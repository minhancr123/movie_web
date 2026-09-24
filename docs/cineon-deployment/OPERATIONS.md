# Cineon Operations Runbook

## Account/Cost Prerequisites
Ensure you have active accounts and billing configured for:
- VPS provider
- Cloudflare for DNS
- Cloud storage/CDN for media delivery

## DNS/TLS Setup (Cloudflare → Caddy)
1. Point your domain to the VPS IP via A records in Cloudflare.
2. Enable "DNS Only" (grey cloud) during initial Caddy TLS setup.
3. Once Caddy acquires certificates from Let's Encrypt, you may switch to "Proxied" if required.

## Provision Flow
Set up your VPS with Docker, Docker Compose, and necessary firewall rules (ports 80, 443).
Secure your server with SSH keys and fail2ban.

## Volume Adoption
Ensure Docker volumes for MongoDB and Redis are properly initialized or mounted from block storage.
Use labeled volumes for the production environment.

## Secret/Bootstrap Setup
Initialize the `.env` file based on `.env.prod.example`.
Never commit `.env` to version control.
Bootstrap the database if necessary.

## Build/Release Cycle
Build Docker images and tag them with release IDs.
Push images to your container registry.

## Deploy/Smoke Testing
Deploy using `docker compose -f docker-compose.prod.yml up -d`.
Run basic curl checks or load tests to ensure the application is responsive.

## CDN/Media Configuration
Configure HLS and direct media paths.
Ensure your upstream storage has the appropriate CORS and bandwidth capacity.

## Sentry/Grafana/Alerts Setup
Configure Sentry DSN in your environment variables.
Set up Grafana dashboards for metrics.
Establish email or Slack alerting for high error rates.

## Backup/Restore Procedures
Use `deploy/backup.sh` to periodically snapshot the database and config.
Practice restoring with `deploy/restore-drill.sh`.

## Release/Rollback Workflow
To release: deploy new image tags.
To rollback: revert the image tag in your configuration and restart the containers.
Note: application rollback is separate from database restoration.

## Maintenance/Incident Procedures
For OOM/disk issues, scale vertically or clear logs.
Announce maintenance windows and monitor alerts.

## Config Upgrade Path
When upgrading environments, compare new `.example` files and apply required changes to production `.env`.
