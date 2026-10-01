#!/usr/bin/env bash
#
# Deploy CineVN directly on this host.
#
# The manual fallback for when CI cannot be used (no runner, no secrets, or
# the change must go out while Actions is down). The CI workflow in
# .github/workflows/deploy.yml covers the same release line automatically;
# this script stays because it builds on the host itself, needs no registry,
# and is the documented way to roll a single SHA out or back by hand.
# It accumulated three distinct failures in one evening — a build whose
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
  # All node services share BACKEND_IMAGE: a scoped restart would leave the
  # worker and scheduler on the failed image, so roll the whole stack.
  BACKEND_IMAGE="$PREV_BACKEND" FRONTEND_IMAGE="$PREV_FRONTEND" RELEASE_ID="$PREV_RELEASE" \
    docker compose -f docker-compose.prod.yml up -d
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
# A local build needs gigabytes of headroom for layers, more than a
# pull does. Same preflight as the CI path: prune first if warm, refuse if
# still too full — a build that dies mid-layer wastes the time it took to
# get there and leaves the disk worse than before.
USEP=$(df --output=pcent / | tail -1 | tr -d ' %')
if [ "$USEP" -ge 85 ]; then
  say "disk at ${USEP}% — pruning before build"
  docker builder prune -af >/dev/null 2>&1 || true
  docker image prune -af >/dev/null 2>&1 || true
  USEP=$(df --output=pcent / | tail -1 | tr -d ' %')
fi
[ "$USEP" -lt 92 ] || die "disk still at ${USEP}% after prune — refusing to build"
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
# starts cold. prune -a, not just -f: superseded images keep their layers
# without consumers (15GB measured), which plain prune never reclaims. This
# runs only after a successful deploy, when rollback images are no longer
# needed — a later manual rollback rebuilds or pulls instead.
say 'pruning build cache'
docker builder prune -af >/dev/null 2>&1
docker image prune -af >/dev/null 2>&1
df -h / | tail -1

say "DEPLOY_OK $SHA"
