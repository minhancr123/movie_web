Cineon deployment kit for Ubuntu 24.04, 1 vCPU, 4 GB RAM, 30 GB SSD.
Read CINEON_DEPLOY_A_Z.md or the Word guide before running commands.
These files are a separate deployment proposal, not modifications to application source.
Use compose.cineon.yml alone, not merged with docker-compose.prod.yml.
Caddy runs as a host systemd service, not inside this Compose stack.
Public ports are 80/443; frontend and backend publish on 127.0.0.1 only.
Copy env.cineon.example to .env.cineon; fill secrets locally on VPS.
Copy release.env.example to current.env; fill real image references.
Frontend NextAuth and backend auth routes intentionally use different upstreams.
Keep production .env files out of both Docker build contexts and source control.
Run smoke.sh only against a deployment you intend to test.
Worker health checks are disabled because inherited API checks are invalid for workers.
Track queue age and process restarts separately; running is not equivalent to healthy.
No public deployment or application load test is performed by creating this kit.
