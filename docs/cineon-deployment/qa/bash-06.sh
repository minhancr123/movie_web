cd /opt/cineon
cp kit/compose.cineon.yml .
cp kit/env.cineon.example .env.cineon
cp kit/release.env.example current.env
chmod 600 .env.cineon current.env
nano .env.cineon
nano current.env
