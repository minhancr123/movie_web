# Admin current viewing — 2026-11-01

Production release: `7803d56deb9de854c426ef88b7c9c80d8a2e84cd`.

The Users table now shows current playing content, episode where applicable,
position and last report time. It refreshes every 15 seconds. Account enabled
status is labelled separately from viewing activity.

The player reports actual media state every 25 seconds and on playback state
changes. Only `playing` reports qualify; paused, buffering and ended do not.
Presence is scoped to authenticated owner + session + viewer, so one tab
leaving cannot remove another tab's presence. Explicit leave removes the record;
an interrupted connection stops qualifying after 75 seconds. TTL deletion is
cleanup only; reads apply freshness checks without waiting for Mongo's TTL pass.
Existing player tabs must reload once to send this new optional report.

Admin-only account responses include safe title/episode/position/time fields;
they omit media URLs, tokens, viewer identifiers and session capabilities.
Session lists also now project owner identifiers before joining account names.

## Validation and activation

- Full backend `npm test` passed on LAN with ffmpeg/ffprobe and isolated Redis
  URLs. The first local run stopped because ffmpeg was absent. An initial LAN
  run kept an imported Redis connection alive; it was stopped and rerun isolated.
- Full frontend `npm test` passed. Production build passed on local and LAN.
- Existing production service-worker version was v5 but registration was v4.
  Registration was aligned with v5; revision tests now permit version bumps and
  still enforce matching revisions.
- HTTP integration exercised authenticated ownership, admin authorization,
  passive leases, play/pause, independent tabs, stale cutoff, leave and safe
  fields. A second integration against the activated service verified playing,
  pause, buffering, ended and leave. All audit fixture rows were deleted.
- Archived source verification: 441 files checked, no differences; both service
  health endpoints served the expected release. Standalone dependencies have no
  symlinks outside the release. Previous hashed assets were retained for open tabs.
- Authenticated visual verification was unavailable: the IAB had no admin login
  and native Brave inspection failed with a capture error. No claim of a visual
  playing-to-paused walkthrough is made.

Existing mutable production playback/catalog changes were recorded separately
in `0272ef6` before building, preserving their behavior rather than overwriting
them. The obsolete mutable CDN test expecting nexus-170 was not imported; the
tracked test passes against the preserved runtime implementation.

Backups, activation script with readiness rollback, and deployment record:
`~/cinevn-deploy-backups/20261101-7803d56deb9de854c426ef88b7c9c80d8a2e84cd/`.
Previous backend: `73b9ce5`; previous frontend: `65b93f1`.
