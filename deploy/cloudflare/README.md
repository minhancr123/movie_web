# Cloudflare Configuration

## DNS Records
- **A Record**: `cineon.me` -> Caddy Server IP (Proxied)
- **A Record**: `media.cineon.me` -> Caddy Server IP (DNS-only)

## Cache Rules
- **Static Assets** (`/static/*`, `/_next/static/*`): Cache level: Cache Everything, Edge Cache TTL: 1 month.
- **API** (`/api/*`): Cache level: Bypass.

## Security Headers
- HSTS enabled
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
