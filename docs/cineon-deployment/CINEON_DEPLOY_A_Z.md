# Cineon Deployment Guide (A-Z)

This comprehensive guide covers the full chain of deployment for Cineon.

## Prerequisites
- **VPS**: A virtual private server running Ubuntu 22.04 or later.
- **Domain**: A registered domain name.
- **Accounts**: Access to Cloudflare (or similar DNS provider), container registry, and external media storage.

## Initial Setup
1. SSH into your VPS.
2. Update packages and install Docker and Docker Compose.
3. Configure your firewall to allow traffic on ports 80 and 443.

## First Deployment
1. Prepare your environment variables by copying `.env.prod.example` to `.env`.
2. Configure your Caddyfile with your domain.
3. Run `docker compose -f docker-compose.prod.yml up -d` to launch the stack.

## Verification
1. Ensure the web application loads successfully on your domain.
2. Verify TLS certificates are issued and active.
3. Check the logs of all containers for errors.

## Day-2 Operations
- Set up automated backups.
- Configure monitoring and alerts.
- Refer to `OPERATIONS.md` for detailed runbooks, incident response, and scaling instructions.
