# Startup/pinned-seek optimization — 2026-10-31

Production code: `e3082b8f302d749076c190a7d9d5ca5ffa5a6d2d`.
Baseline: production `2a4b51c`, inspected in
`startup-seek-followup-20261030.md`. This change does not resolve or close the
reported pause/resume black-picture/harsh-audio issue.

## Changes

- Begin downloading the existing dynamic VideoPlayer module when resolve starts,
  rather than waiting for resolve to complete before downloading its chunk.
  Importing the module does not mount the player or start a media writer.
- Retain bounded discovery snapshots for 60 seconds (64 credential/config/content
  scopes, at most 160 candidates each). An exact, unambiguous pin can reuse this
  metadata. Account credentials/configuration, title, season and episode are
  hashed into the scope; no credential is used as a plaintext map key.
- Only check availability/probe facts for the pin's matching candidates. Auto
  discovery and the alternatives endpoint retain their complete discovery flow.
  Legacy bare hashes keep all matching pack files for ranking. Missing/ambiguous
  snapshot matches rediscover; explicit fresh discovery invalidates snapshots,
  including older in-flight results. Entitlement, file preparation, link and
  playback permission checks remain in place.
- Metadata prewarm reads the same remembered source key as playback, including
  season/episode isolation. Explicit direct-provider pins avoid warming an
  unrelated automatic TorBox source. Prewarm starts no FFmpeg writer.
- Session reuse checks an exact source identity as well as existing owner,
  content, audio, capability, expiry, generation and runway checks. Legacy rows
  require an exact normalized full filename; matching basenames are insufficient.

No timestamp, codec, subtitle-clock, segment, read-rate, startup-headroom or
900-second-window settings were changed. HTTP reuse remains enabled and the
previously rejected native HLS start hint remains disabled.

## Verification and deployment

- [GitHub Actions 41088089993](https://github.com/minhancr123/movie_web/actions/runs/41088089993):
  PASS backend, media integration/baseline timestamp matrix, frontend tests and
  typecheck, frontend build and manifest/deployment tests.
- Seven new backend regression cases cover the production scope, isolated
  credentials/episodes, exact-file cache reuse, ambiguity, expiry/bounds,
  refresh/in-flight invalidation and narrowed availability checks.
- Frontend source-delivery tests cover remembered source lookup and unavailable
  browser storage; full frontend suite and typecheck also pass locally.
- Local full backend run stopped at the existing mandatory FFmpeg assertion
  because FFmpeg was unavailable on this Mac's PATH. No test was disabled:
  the complete suite subsequently passed on LAN with its installed FFmpeg,
  using the isolated new release without production environment/secrets.
- LAN source-integrity check: 433 tracked backend/frontend files match Git blobs.
  Private backend/frontend previews passed before activation. Node 24 build,
  physically isolated frontend dependencies, standalone Next/Sharp resolution
  and native image optimization were verified.
- Both production services and the public health endpoint report `e3082b8`.
  Activation refused active FFmpeg writers and retained an automatic rollback.
  Backup/evidence: `~/cinevn-deploy-backups/20261030-e3082b8f302d749076c190a7d9d5ca5ffa5a6d2d/`.

## Runtime evidence and limits

The logged-in in-app browser loaded Endgame, sought to 12:00, and was observed
playing at 12:13 and then 13:18 without a stuck loading overlay. The alternatives
list remained populated and marked only the current source. Selecting that source
explicitly and seeking to 12:00 again also resumed playback (observed at 12:44
and 13:00); the test tab was paused afterward. This is a browser
smoke check, not a physical iPhone or controlled cold-seek benchmark.

An early post-deploy registry snapshot had two remux first-frame observations
(sum 9.8719 seconds), one seek observation (0.1108 seconds), and two server
source-stage observations (sum 0.012 seconds). Existing media/provider caches
were warm and the samples are not paired with baseline requests. They do not
establish a general latency reduction or cold-seek floor. The displayed 4K label
for the selected LoRD file remains a known metadata issue; it is not proof of
true 4K playback. Physical Safari/iPhone comparison and the pause/resume audio
report remain open. Progressive subtitle inventory is not completed by this work.
