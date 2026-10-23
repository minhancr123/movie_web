# Embedded English subtitle availability and timeline review

Deployed source: `8be1298a3f60afef38d07f4017f65e8aef8d4a8a`.
Both LAN services use `/home/minhancr123/cinevn-runtime/8be1298`.
Public `/release` agrees; homepage returns HTTP 200. Backend and frontend
health checks are ready, with zero service restarts after activation.

## Availability fix

The former extractor created final VTT paths before FFmpeg finished. File
existence could therefore publish a zero-byte subtitle, which the browser
cached as an empty cue list. Full-file extraction and stale pending jobs after
a process restart made recovery unreliable.

Extraction now uses five-minute windows starting every two minutes, preserves
absolute source timestamps, discards keyframe preroll cues outside the window,
and publishes validated WebVTT atomically. The browser refreshes overlapping
windows while preserving the chosen track and its manual calibration. Pending
jobs identify their worker process. Failed inventories have a short retry TTL.
Stable subtitle storage is configured outside release directories at
`/home/minhancr123/cinevn-state/subtitles`, mode 0700.

No new fixed audio delay or global subtitle offset was introduced. Watch history
and resume preferences were not reset.

## Clock diagnostics

Owned-session telemetry records bounded numeric clock fields: requested start,
actual origin, presentation shift, audio and subtitle stream indices, cue start,
player time, absolute time, subtitle lookup time and manual delay. Server-side
mapping errors are derived from the owned session. Extraction logs record cue
counts and times. Neither path records cue text, signed media URLs or keys.
Diagnostic snapshots do not increment normal playback performance metrics.

## Verification

- Complete backend suite passed locally and on LAN.
- Frontend: 121 tests passed; production builds passed locally and on LAN.
- Real MKV-to-WebVTT regression verifies absolute cue times and exclusion of
  keyframe preroll cues.
- Controlled H.264 B-frame / DTS-to-AAC fixture has known visual, audio and
  subtitle markers. At start 0: A/V marker difference 11 ms, subtitle clock
  error 0 ms. At requested 197 s: actual origin 194 s, A/V difference 8 ms,
  subtitle clock error 0 ms. Presentation shift is 83 ms. Re-reading the same
  HLS bytes preserves both marker positions.
- Real Avengers 299536 API resolves, with a separate QA identity and pinned
  source/audio: start 0 -> origin 0; start 197 -> origin 192.192 s. Repeating
  197 reuses the same session and origin. Presentation shift remains 83 ms and
  audio index remains 0. QA viewer leases were explicitly released. No fake
  first-frame or seek performance events were submitted.
- Real Avengers English stream 4, window 0: final VTT HTTP 200, 2632 bytes,
  52 cues, first cue 24.520 s, last cue start 265.320 s. Before completion the
  API correctly reported `ready: false` with no URL. Cached read completed in
  under one second. Cold extraction remains dependent on upstream throughput.
- Real Avengers stream 4, requested position 197, window 120: HTTP 200,
  2064 bytes, 42 cues, first cue 124.280 s and last cue start 398.320 s.
  This cold extraction took 70 seconds. Availability is fixed, but this latency
  remains a startup limitation; overlapping refresh helps during continuous play.
- Re-reading both cached windows completed in under one second each. Public
  `cinevn.me` VTT requests returned HTTP 200 and identical bytes to the private
  backend for both windows.

The controlled marker results and real API clocks are not a measurement of
dialogue lip-sync in the film. Human verification asks for delay 0, the same
audio track, playback from the beginning and at 3:17, with separate observations
of subtitle/voice and mouth/voice alignment. That confirmation is still pending.

The repository's requested `graft build` refresh could not run because the
`graft` executable is unavailable in this workspace.
