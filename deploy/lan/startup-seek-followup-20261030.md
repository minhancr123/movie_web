# Startup and seek follow-up inspection — 2026-10-30

Inspection of production `2a4b51c`; no runtime configuration or playback code
changed during this inspection. The pause/resume black-picture and harsh-audio
report remains unresolved. The user says it happens after pausing only seconds;
it must not be explained away as an expired long-idle session.

## Current measurements and their limits

Local Prometheus registry, since the current backend process started:

| Measurement | Observations | Sum | Mean |
| --- | ---: | ---: | ---: |
| Remux client first-frame latency | 3 | 26.143s | 8.714s |
| Client remux seek latency | 1 | 1.272s | 1.272s |
| Server source stage | 4 | 7.310s | 1.828s |
| Server remux stage | 2 | 12.393s | 6.197s |
| Server probe stage | 2 | 0.015s | 0.0075s |

These are small process-local samples across requests, not Endgame-only paired
benchmarks. Do not add the stage means: observation counts and request sets
differ. One seek observation cannot characterize cold/unbuffered seeking or
establish p95. The remux stage includes playlist/origin readiness work, not just
encoding CPU. No new controlled Safari benchmark was performed in this check.

Active settings: HTTP reuse enabled, read rate 2, initial burst 8 seconds,
900-second window, nominal segments 4 seconds. Startup defaults to 12 seconds
but existing adaptive policies can lower it after observing a fast writer;
seek runway defaults to target plus 4 seconds.

## Already present; avoid duplicating it

- Persistent HTTP reuse, codec metadata cache and in-flight probe coalescing.
- Four-second cold-seek buckets and fractional runway coverage checks.
- Origin probing overlaps writer initialization; repeated origins are cached.
- Adaptive startup headroom based on actual published media and writer time.
- Metadata prewarm from hover/touch/click. It intentionally does not start a
  writer; therefore it cannot hide the whole first-remux delay.
- Preparation of the next remux window, starting up to 45 seconds before its
  boundary. It does not precompute arbitrary far-away seek destinations.
- Source discovery/ranking, session reuse, queued foreground priority, stale
  seek cancellation, and separate background subtitle loading already exist.

## Remaining opportunities, in priority order

1. **Pinned-source / owned-session fast path.** Main resolve still performs
   discovery and `checkCached` for the candidate pool before its reuse check.
   Even a pinned request narrows ranking only after that availability work.
   First bound the cached check to the selected candidate; then consider a
   validated owned-session path that bypasses listing for the exact known file.
   Keep account authorization, source freshness, content/episode, audio and
   capability validation. Cache/provider failure must retain existing fallback.

2. **Prewarm the same source that will actually play.** The link prewarm sends
   content/capabilities, while playback can select a remembered source. The
   backend prewarm chooses Auto's best candidate, so it can warm a different
   release. Connect manual/remembered identity and playback source choice before
   considering a bounded first-segment warm-up for explicit viewing intent.
   Limit background work; do not spawn a writer for every visible movie card.

3. **Reduce cold producer overhead, experimentally.** The largest measured
   stage is still remux readiness. Compare connection/origin-probe overhead and
   reuse of already produced regions on the same source and same seek target.
   A shared immutable segment cache is a larger change; it must key the exact
   file, audio selection and remux recipe, and retain per-viewer grants/leases.
   Keep the already implemented next-window preparation rather than rewrite it.

4. **Verify stable pause/resume before more aggressive starts.** The newest
   inspected Endgame session is H.264 High, 1920×804, with stereo AAC 48kHz,
   despite a 4K label. It is not evidence that HEVC/4K is the cause. Native
   Safari is excluded from the current Web Audio enhancer path by code, so
   blaming an audio effect requires actual browser evidence. Inspect the same
   affected session's packets and browser decoder/lifecycle before changing
   timestamps or adding automatic reload loops.

Before expanding reuse, inspect exact file identity as well: the existing
`findReusableRemuxSession` API/query receives user/content/torrent/audio but no
requested candidate file index. Different files in one torrent must not become
interchangeable merely to speed up selection. This is a review finding, not a
confirmed cause of the reported black picture/noise.

## Acceptance for subsequent changes

Separate cold open, warm reopen, buffered seek, cold seek, and pause/resume on
the same source/device. Record request-to-frame plus resolve, playlist and
decoder phases; verify destination frame, A/V and subtitle clocks. Measure
multiple trials and resource use. Retain the withdrawn native start hint OFF,
and retain the existing timestamp tolerances. Physical iPhone seek and
progressive subtitle inventory acceptance remain pending.

Relevant implementation: `controllers/playbackController.js` source/rank/reuse
flow and `prewarmPlayback`; `services/playback/startupPolicy.js`;
`services/playback/remuxService.js` probes and HTTP transport;
`frontend/src/components/PrewarmWatchLink.tsx`, `PlaybackSection.tsx`,
`VideoPlayer.tsx`, and `frontend/src/lib/prepared-window.ts`.
