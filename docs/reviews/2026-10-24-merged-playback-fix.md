# Merged playback baseline: fixes and production verification

Application release: `8ae0fe522bbe11e26bd08859c44e17ab1eb97cfa`.
Shared branch: `optimize/perf-20261024`. Merge commit `2424453` includes both
`24ad3c6` and `3a71c7f`; `8ae0fe5` additionally fixes the adopted-session
heartbeat/leave reference. Subsequent documentation changes do not alter the
application release recorded here.

## Changes

- Retained the optimize branch's catalog, resume, notification, source-ranking,
  and playback changes while restoring Vietnamese-first subtitle ordering,
  bilingual pairing, refreshing both tracks, and persisted display order.
- Introduced v6 subtitle sidecars and inventory keys. An embedded WebVTT NOTE
  carries the actual covered intervals, published atomically with the cues.
  Partial slices retain partial coverage and cannot extend it by being sliced
  again. Old v5 files are not trusted as v6 coverage.
- Refills remain visible as jobs even when the currently requested bucket is
  already playable. Both fast and full inventory paths preserve the need to
  refill. The player reloads changed VTT URLs within the same window, receives
  updated coverage, and shares in-flight cue fetches between rendering and
  scoring instead of reading stale React snapshots.
- Extraction writes filtered content to its temporary file and renames only
  after success. A publication failure preserves the previous final file.
- Alignment uses target-minus-reference offsets, source-time anchors, only
  actually covered intervals, distinct matched lines and conservative confidence
  checks. Periodic/ambiguous or sparse evidence does not move the subtitles.
  Manual timing overrides take precedence. Hints describe cue timing evidence
  rather than claiming it proves dialogue lip-sync or a different film cut.
- Corrected heartbeat and leave to reference the owned adopted session rather
  than an undefined variable.

## Automated verification

The complete backend suite passed locally and on LAN. Frontend has 126 passing
tests; TypeScript and production builds passed. Linux FFmpeg regressions passed
for HEVC roundtrip, A/V timing, real MKV subtitle extraction, start 0, seek 197,
and reused HLS bytes. Added regressions cover chained partial slices, quiet
coverage, failed atomic replacement, offset direction in both directions,
full-film versus short-window comparison, ambiguity and drift anchors.

`graft map/ask/build` could not run because the executable is unavailable in the
workspace; focused source reads and the above checks were used.

## Deployment

Both services now run under the new, separate directory
`/home/minhancr123/cinevn-runtime/8ae0fe5`, with the same RELEASE_ID. Older
runtime directories were not overwritten. Activation checked the previous
release IDs and unit directories, backed up unit configuration and private
environment files, and included automatic rollback if readiness failed.

Private backend health, private frontend health and public `/release` agree on
8ae0fe5. Public homepage and auth-session endpoint return HTTP 200. Both services
are active, with NRestarts 0 after activation. Stable subtitle storage remains
outside release directories.

## Real-source verification

Avengers 299536, pinned source and audio index 0, separate ephemeral QA identity:

- Resolve 0: origin 0, presentation shift 83 ms, heartbeat succeeds (6 s).
- Resolve 197: origin 192.192, shift 83 ms, heartbeat succeeds (4 s).
- Repeat 197: same session reused, same timing metadata (under 1 s).
- Window 0 English: initially unready with a job; final public VTT HTTP 200,
  52 cues, coverage [0,300], first cue 24.520 s (32 s cold extraction).
- Request position 197: immediately ready from a partial slice with honest
  coverage [120,300] and a refill job. Refill completes with coverage [120,420],
  public VTT HTTP 200 and 42 cues (19 s).
- Both QA viewer leases were released successfully. No artificial first-frame
  or seek performance telemetry was submitted.

Safari verification used a separate temporary Avengers tab. Vietnamese tracks
appeared before English; enabling bilingual exposed both display-order controls.
Selecting Vietnamese-first changed the pressed state, and English-first was
restored and verified. The QA tab was closed; the original Hope tab remained
paused at 6:31. No lip-sync conclusion is inferred from these UI observations.

## Limits and continuation

Cold subtitle extraction still depends on upstream throughput; these timings
are individual observations, not a latency guarantee. Ambiguous subtitle timing
requires human checking or manual adjustment. No 100-viewer/4K load capacity
claim follows from this verification.

Continue from the shared optimize baseline. Build into a new release directory
and activate the tested artifacts together; do not copy another branch over an
existing runtime directory whose name identifies an older commit.
