#!/usr/bin/env bash
#
# Disk watchdog for the 30 GB box. Runs from cron every 30 minutes.
#
# What already cleans itself, and why this still exists:
# - the transcode janitor (every 60s) manages only its own cache dir against
#   its own GB cap, never the filesystem;
# - container logs rotate (10m x 3) via compose;
# - deploys prune builder cache and unused images, but only on success.
# None of them watches overall disk usage and none runs between deploys.
# Pulled digest images were measured accumulating 15 GB in a single week,
# which filled the disk and made the remux guard refuse every film.
#
# Over THRESHOLD_PCT it prunes what no container uses (builder cache plus
# untagged images) and logs before/after. It never touches running
# containers, volumes, or the transcode cache — the app's janitor owns that,
# and deleting what it is filling would corrupt in-flight viewers.
#
# Install:
#   (crontab -l 2>/dev/null; echo "*/30 * * * * /opt/cineon/deploy/disk-watchdog.sh >> /opt/cineon/disk-watchdog.log 2>&1") | crontab -
set -uo pipefail

THRESHOLD_PCT="${DISK_WATCHDOG_THRESHOLD_PCT:-80}"

log() { printf '%s [disk-watchdog] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

usep=$(df --output=pcent / | tail -1 | tr -d ' %')
log "use=${usep}% threshold=${THRESHOLD_PCT}%"

if [ "$usep" -lt "$THRESHOLD_PCT" ]; then
  exit 0
fi

log "OVER THRESHOLD — pruning unused docker data (running containers and volumes untouched)"
docker builder prune -af >/dev/null 2>&1 || true
docker image prune -af >/dev/null 2>&1 || true
after=$(df --output=pcent / | tail -1 | tr -d ' %')
log "after prune: use=${after}%"
df -h / | tail -1
