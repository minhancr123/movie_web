# CineVN production operations

Production images are built and tested in GitHub Actions, then deployed by
digest. Do not build application images on the VPS. All source changes,
including hotfixes, must be committed and pushed before deploying.

## Playback budget

The 1-vCPU host admits one FFmpeg writer (`REMUX_MAX_WRITERS=1`). Compatible
containers play directly; remux copies video and known mono/stereo AAC-LC.
Other audio is encoded to compatible AAC. `REMUX_READ_RATE=2` limits input to
twice playback speed instead of processing the whole film at maximum CPU.
Existing sessions/renditions are reused. Viewer leases are reaped by the
minute janitor, including when no new viewer is waiting. Untracked sessions
retain the idle timeout. Active viewers are never deleted to meet a cache cap.

### Bounded remux and seeking

`PLAYBACK_REMUX_WINDOW_SECONDS=600` enables finite ten-minute VOD chunks for
clients advertising `windowedRemux`. The default is zero; older clients keep
the full-film pipeline. Known bitrate can shorten a chunk to fit an estimated
0.85 GiB media budget. Disk reservations price only the remaining chunk, while
the existing free-space reserve and one-writer admission still apply. Unknown
film duration keeps the legacy pipeline. This estimate is not a hard byte cap.

Direct compatible files seek using the CDN's byte-range support. MKV sources
go through FFmpeg into append-only HLS playlists with small fMP4 segments.
For a far seek, the server opens the source near the requested film time and
reports its measured keyframe origin. The player advances inside that chunk
to the requested time rather than showing the earlier keyframe. Recovery
retains that target until playback reports progress there. Completed partial
sessions are reused only when their actual playlist covers the requested time;
published seek tails with an unknown origin are no longer reused.

Near a chunk's end the player prepares the next chunk in the background and
then switches while preserving play/pause intent and the full-film clock.
A failed preparation falls back to a foreground resolve and can pause briefly.
Finite chunks carry `.windowed` and cannot be published as complete films.
The existing 3 GiB session cache and 3 GiB rendition cache evict idle data;
active leases can temporarily exceed these targets. No sliding/live playlist
or deletion of segments currently being watched is introduced.

## Monitoring and recovery

Run `sudo python3 deploy/production_ops.py install` once. Systemd timers
check container state and local/public HTTP probes every minute. Three
consecutive unhealthy checks permit recovery, capped at once per 15 minutes
and three restarts per hour. CPU pressure never triggers a restart.

Metrics are written atomically to `/var/lib/alloy/textfile/cineon.prom` and
sent by the existing Grafana Alloy unix exporter. They include probe health,
latency, disk usage, memory available, and last successful backup/restore.
Check `journalctl -u cineon-monitor` for recovery events. Grafana rules/contact
points must be configured in the user's stack to deliver notifications.

Sentry backend DSN is passed into Docker; instrumentation initializes before
Express and its error middleware. The frontend obtains the public ingestion
DSN through `/observability-config`, so its configuration does not depend
on a rebuild. Login/cookie headers, request bodies and sensitive URLs are
redacted. A caught expected 404/no-source response is not an application crash.

## Backup and restore

`sudo bash deploy/backup.sh` pauses the three application writers for the
MongoDB dump and persistent queue Redis snapshot, then resumes them even on
failure. TTL/background writes outside the application are not paused. The
encrypted restic snapshot also contains `.env` (including token encryption
keys), compose and Caddy config. The disposable catalog cache and media cache
are excluded. Daily backup runs at 02:00 Vietnam time, weekly restore drill
at 03:00 Monday. Keep 7 daily, 4 weekly and 3 monthly snapshots; forgotten
snapshots are reclaimed only by explicit restic prune.

The default repository is `/var/lib/cineon-backups`, password at
`/var/lib/cineon-ops/restic-password` (root-only). **A local repository does
not protect against loss of the VPS.** Configure an independent repository
using root-only `/var/lib/cineon-ops/restic.env` with `RESTIC_REPOSITORY` and
the destination's authentication variables. Save the restic password safely
outside the VPS as well. Never commit the password, backup archive, DSNs or
provider credentials to Git.

`sudo bash deploy/restore-drill.sh --snapshot latest` restores into temporary
MongoDB with no network and no published ports, checks collection/document
counts and index names, validates the Redis RDB, and reads all restic data to
check integrity. It does not overwrite production. This verifies structural
recovery, not a complete end-to-end application/key decryption test.

## Rollback

CI preserves the previous backend/frontend images and `.rollback.env`.
`sudo bash deploy/rollback.sh` switches the complete stack to that pair,
checks API/frontend health and updates `.env` only on success. Backup,
restore, monitor recovery and deployment share a production operation lock.
Docker image cleanup preserves tagged rollback images; no `image prune -a`.

## Host incident noted on 2026-10-13

Root cron contained four entries for a missing random executable under
`/var/tmp`. Entries were saved under `/root/cineon-incident-20261013` and
disabled. No corresponding running executable was found. This does not
establish that the host is clean; investigate login history/persistence,
rotate credentials and rebuild the host if compromise is confirmed.
