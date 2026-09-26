#!/usr/bin/env bash
#
# Deploy CineVN directly on this host.
#
# Why it exists and why it is a real script rather than a paste: the repository's
# CI workflow only triggers on a push to main, and this release line lives on a
# feature branch, so every deploy was being done by hand. Hand-written versions
# of that accumulated three distinct failures in one evening — a build whose
# error guard had been deleted (reported DEPLOY_OK having shipped nothing), a
# frontend-only script run where a backend deploy was intended, and a mangled
# command line that took the frontend build down with it. Each one printed a
# success line. This file is the one place that has to be right.
#
# Guarantees:
#   - a failed build or a failed `compose up` aborts before anything restarts
#   - the running image is asserted against the one just built, because health
#     probes pass just as happily against the OLD container
#   - a failure rolls back to the previous image IDs, not the previous tags
#   - build cache is pruned at the end; 13 builds on a 30 GB disk left 9.8 GB of
#     cache and 8.1 GB reclaimable, which is most of why it reached 87% full
#
# Usage:  deploy-local.sh            # deploy the current branch tip
#         deploy-local.sh <sha>      # deploy a specific commit
set -uo pipefail

SHA="${1:-$(cd /opt/cineon && git rev-parse --short HEAD)}"
cd /opt/cineon || exit 1

API_ORIGIN="${API_ORIGIN:-https://cinevn.me}"
API_URL="${API_URL:-${API_ORIGIN}/api}"

say() { printf '\n=== %s\n' "$*"; }
die() { printf 'FAIL: %s\n' "$*"; exit 1; }

# --- previous state, for rollback -------------------------------------------
PREV_BACKEND=$(docker inspect -f '{{.Image}}' cineon-backend)
PREV_FRONTEND=$(docker inspect -f '{{.Image}}' cineon-frontend)
PREV_RELEASE=$(grep -E '^RELEASE_ID=' .env | cut -d= -f2)
say "deploy $SHA  (rollback: ${PREV_FRONTEND:0:19} / ${PREV_BACKEND:0:19} / $PREV_RELEASE)"

rollback() {
  say 'ROLLING BACK'
  BACKEND_IMAGE="$PREV_BACKEND" FRONTEND_IMAGE="$PREV_FRONTEND" RELEASE_ID="$PREV_RELEASE" \
    docker compose -f docker-compose.prod.yml up -d --no-deps backend-node frontend
  wait_for http://localhost:5001/healthz 18 && wait_for http://localhost:3000/api/health 18 \
    && say 'rolled back and healthy' || say 'ROLLBACK DID NOT COME UP'
}

# --- source -----------------------------------------------------------------
git fetch --quiet origin || die 'git fetch'
git checkout --quiet "$SHA" || die 'git checkout'
GOT=$(git rev-parse --short HEAD)
[ "$GOT" = "$SHA" ] || die "checked out $GOT, expected $SHA"
say "files in $SHA"
git diff --name-only HEAD~1..HEAD | sed 's/^/    /'

# --- build ------------------------------------------------------------------
docker build -q -t "minhancr123/movie-web:node-$SHA" -f backend-node/Dockerfile ./backend-node \
  || die 'backend build'
docker build -q --build-arg NEXT_PUBLIC_API_URL="$API_URL" \
  -t "minhancr123/movie-web:web-$SHA" -f frontend/Dockerfile ./frontend \
  || die 'frontend build'
docker image inspect "minhancr123/movie-web:node-$SHA" >/dev/null 2>&1 || die 'node image missing after build'
docker image inspect "minhancr123/movie-web:web-$SHA" >/dev/null 2>&1 || die 'web image missing after build'
say 'BUILDS_OK'

# --- cut over ---------------------------------------------------------------
FULL=$(git rev-parse HEAD)
BACKEND_IMAGE="minhancr123/movie-web:node-$SHA"
FRONTEND_IMAGE="minhancr123/movie-web:web-$SHA"
export BACKEND_IMAGE FRONTEND_IMAGE RELEASE_ID="$FULL"
docker compose -f docker-compose.prod.yml up -d backend-node frontend || { die 'compose up'; }

wait_for() {
  local i
  for i in $(seq 1 "$2"); do
    if curl -fsS -o /dev/null --max-time 15 "$1" 2>/dev/null; then
      echo "    ok  $1 (${i})"; return 0
    fi
    sleep 5
  done
  echo "    FAILED  $1"; return 1
}

ok=1
wait_for http://localhost:5001/healthz 24   || ok=0
[ "$ok" = 1 ] && { wait_for http://localhost:3000/api/health 18 || ok=0; }
[ "$ok" = 1 ] && { wait_for "$API_ORIGIN/healthz" 12 || ok=0; }
[ "$ok" = 1 ] && { wait_for "$API_ORIGIN/" 12 || ok=0; }
[ "$ok" = 1 ] && { wait_for "$API_ORIGIN/release" 6 || ok=0; }

# Health alone proves nothing about which image is live: the old container passes
# every one of those probes. Assert identity.
for pair in "cineon-backend:$BACKEND_IMAGE" "cineon-frontend:$FRONTEND_IMAGE"; do
  c=${pair%%:*}; want=${pair#*:}
  got=$(docker inspect -f '{{.Config.Image}}' "$c" 2>/dev/null)
  if [ "$got" = "$want" ]; then echo "    identity ok  $c -> $got"; else echo "    MISMATCH $c runs $got, wanted $want"; ok=0; fi
done

if [ "$ok" != 1 ]; then rollback; exit 1; fi

sed -i "s|^RELEASE_ID=.*|RELEASE_ID=$FULL|" .env

# --- report and clean up ----------------------------------------------------
say 'running'
for c in cineon-backend cineon-frontend cineon-worker cineon-scheduler; do
  printf '    %-18s %-44s %s\n' "$c" \
    "$(docker inspect -f '{{.Config.Image}}' "$c" 2>/dev/null)" \
    "$(docker exec "$c" printenv RELEASE_ID 2>/dev/null)"
done
echo "    $(curl -fsS --max-time 15 "$API_ORIGIN/release")"

# Every build on this host leaves its layers behind. Thirteen of them filled the
# disk to 87%. Regenerable, so it goes; the only cost is that the next build
# starts cold.
say 'pruning build cache'
docker builder prune -af >/dev/null 2>&1
docker image prune -f >/dev/null 2>&1
df -h / | tail -1

say "DEPLOY_OK $SHA"
