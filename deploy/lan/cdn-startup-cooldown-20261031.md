# Startup: failed CDN avoidance and seek inventory reuse

Code release: `53e884e0ffdc3a1f4faf4bef7143d10961cf5818`.
CI: https://github.com/minhancr123/movie_web/actions/runs/41163048732 (all steps passed).

## Observed before

Tom and Jerry, movie 42246, automatic source, start 0, 2026-10-31 10:10:33 Asia/Ho_Chi_Minh:
- backend resolve 20.6s;
- first HEVC candidate: 5.3s remux phase ending in TCP connection timeout to nexus-230;
- second H.264 candidate: prepare 5.3s, probe 1.6s, remux 2.8s; response successful;
- browser reached readyState 4 with 39.189s buffered, paused by autoplay policy.
This is a backend resolve measurement, not time to first moving frame.

## Changes

- Only confirmed TCP connection failures open a 60s per-host cooldown for HTTPS `*.tb-cdn.pw` nodes. Cached and fresh requestdl URLs pass the same gate.
- API requests, other CDN nodes, HTTP auth errors, timestamp warnings and deliberately stopped writers do not open this circuit.
- At most 128 hostnames are retained in memory; no signed URLs or credentials are stored by the circuit. Expired nodes become eligible again.
- Successful file inventories are reused for 120s instead of 30s. Credential isolation, max entries, explicit fresh invalidation and single-flight behavior remain in force. Download URL lifetime is unchanged.
- FFmpeg arguments, timestamps, subtitles, requested quality and admission limits are unchanged.

## Validation

- Real adapter tests cover cached-link avoidance without an API call and fresh-link enforcement; unaffected cached host remains available.
- Inventory tests cover 119.999s reuse, expiry beyond 120s, fresh invalidation and account isolation.
- Full backend suite passed on LAN in an isolated release without production .env.
- Isolated backend preview healthy; source files checked against git blob hashes.
- Production and real playback measurements are recorded below after activation. No claim of universal instant playback or physical Safari/iPhone performance follows from unit or CI results.

## Production verification

- Activated backend 53e884e with healthy /healthz. Frontend remained 65b93f1 and its process was not restarted. Activation waited for all FFmpeg writers to finish/stop; the first guarded attempt refused to interrupt an active writer.
- Fresh browser visit after activation: backend resolve 5.3s, pinned successful H.264 1080p file; prepare 1.5s, cached link/probe 0s, remux 3.0s.
- UI seek to 418s: backend 3.4s; sources 0.6s, prepare/link/probe 0.0s, remux 2.3s, startup buffer 0.5s. Source origin 415.670s.
- Subsequent browser observation: displayed 7:08, element currentTime 13.275507s, playing (paused=false), readyState 4, no media error. Origin + local clock is approximately 7:09; the displayed whole-second clock was sampled independently.
- Screenshot: /tmp/cinevn-fast-start-after.png.
- These are individual observations, not an identical cold-start A/B: the earlier 20.6s run was Auto with a failed HEVC candidate, whereas the 5.3s run pinned the previously successful H.264 candidate. Do not attribute the entire difference to this release or claim instant playback. The initial real outage can still cost one connection timeout before the node is learned; the circuit is process-local and lasts 60s.
- Actual production cooldown failure/skip sequencing was not forced in the user's browser. Adapter tests prove both link paths enforce the guard. Physical Safari/iPhone startup/seek timings and a long playback soak remain unverified for this release.

### Follow-up limitation

The initial screenshot at 7:21 contains a loading spinner. Later samples advanced to 8:18 and 9:05 without a media error, but readyState was 2 with approximately 0.24s of common buffered data at both observations. Meanwhile the writer's disk playlist had 324s prepared. This does not establish uninterrupted playback: delivery/player buffering requires separate investigation. The test was deliberately paused at 9:44 and navigated home before closing to release its session. Final paused screenshot: /tmp/cinevn-fast-start-paused.png. Do not present either screenshot as proof of consistently smooth playback or instant seek.
