#!/usr/bin/env bash
set -euo pipefail
cd "${CINEON_ROOT:-/opt/cineon}"
exec 9>/var/lock/cineon-production.lock
flock -x 9
test -s .rollback.env
set -a
source .rollback.env
set +a
docker image inspect "$BACKEND_IMAGE" "$FRONTEND_IMAGE" >/dev/null
docker compose -f docker-compose.prod.yml up -d --pull never
for i in $(seq 1 24); do
  if curl --max-time 5 -fsS http://127.0.0.1:5001/healthz >/dev/null && \
     curl --max-time 5 -fsS http://127.0.0.1:3000/api/health >/dev/null; then
    python3 - <<'PY'
from pathlib import Path
import os
p = Path('.env')
keys = ('BACKEND_IMAGE', 'FRONTEND_IMAGE', 'RELEASE_ID')
rows = [s for s in p.read_text().splitlines() if s.split('=', 1)[0] not in keys]
p.write_text('\n'.join(rows + [k + '=' + os.environ[k] for k in keys]) + '\n')
PY
    echo "OK rollback $RELEASE_ID"
    exit 0
  fi
  sleep 5
done
echo 'ERROR rollback health checks failed' >&2
exit 1
