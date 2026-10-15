#!/usr/bin/env bash
#
# Disk watchdog for the 30 GB box. Installed as a systemd timer every 15 minutes.
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
# Below the free-space floor or over THRESHOLD_PCT it removes obsolete
# release digests and disposable Docker cache, preserving pinned rollback images. It never touches running
# containers, volumes, or the transcode cache — the app's janitor owns that,
# and deleting what it is filling would corrupt in-flight viewers.
#
# Install:
#   (crontab -l 2>/dev/null; echo "*/30 * * * * /opt/cineon/deploy/disk-watchdog.sh >> /opt/cineon/disk-watchdog.log 2>&1") | crontab -
set -uo pipefail

THRESHOLD_PCT="${DISK_WATCHDOG_THRESHOLD_PCT:-75}"
MIN_FREE_GB="${DISK_WATCHDOG_MIN_FREE_GB:-9}"
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)

log() { printf '%s [disk-watchdog] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

usep=$(df --output=pcent / | tail -1 | tr -d ' %')
log "use=${usep}% threshold=${THRESHOLD_PCT}%"

free_kb=$(df --output=avail / | tail -1 | tr -d ' ')
if [ "$usep" -lt "$THRESHOLD_PCT" ] && [ "$free_kb" -ge "$((MIN_FREE_GB * 1024 * 1024))" ]; then
  exit 0
fi

log "LOW HEADROOM — pruning obsolete release images (container and rollback pins preserved)"
python3 "$SCRIPT_DIR/prune-release-images.py" --apply || log "release cleanup failed; retained images"
docker builder prune -af >/dev/null 2>&1 || true
docker image prune -f >/dev/null 2>&1 || true
after=$(df --output=pcent / | tail -1 | tr -d ' %')
log "after prune: use=${after}%"
df -h / | tail -1
