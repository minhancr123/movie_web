Cineon Deployment Package
=========================

This package contains the verified files required to deploy and operate the Cineon platform.

Contents include:
- Docker Compose definitions
- Caddy reverse proxy configuration
- Deployment, backup, and restore scripts
- Environment variable templates
- Operations and Deployment documentation

Prerequisites:
- Ubuntu 22.04+ (or compatible Linux)
- Docker and Docker Compose installed
- Target domain and necessary external API accounts

Security Warning:
This package should NEVER contain actual production secrets. Always provide your own .env file based on the included .env.prod.example.

To start deployment:
Read CINEON_DEPLOY_A_Z.md for an end-to-end guide.
Refer to OPERATIONS.md for maintenance and ongoing operations.
