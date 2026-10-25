# WAN measurements and mobile playback regression

## Measurements before the fix

- Existing TorBox sources, six complete 16-MiB HTTP ranges at start/middle/tail:
  113.12, 231.42, 136.61, 114.79, 163.14, 92.06 Mbps; every response 206.
- Four 64-MiB HTTP/1.1 upload samples to Cloudflare's documented speedtest
  endpoint: 201.59, 252.95, 258.95, 239.70 Mbps. Individual transfers took
  2.07–2.66 seconds; this is not sustained WAN viewer capacity.
- Public readiness checks using curl passed before/during the fourth sample.
  Earlier Python urllib readiness requests received 403 even at baseline;
  those invalid probes are not evidence that the website went down.
- An attempted SSH check from the old VPS timed out; no independent remote
  throughput result was obtained from it.
- User agreed to test on mobile data, then reported blinking and repeated
  playback of the same interval. Client metrics recorded one first frame at
  9.508s; during observation they accumulated 50.816s playing and 62.977s
  buffering. These are aggregate counters during that interval, not a
  per-session attribution or a successful mobile acceptance result.

## Confirmed backend defect

The Hope source was adopted from a scheduler-created remux. Logs showed that
producer had been superseded by other prewarmed titles; its directory had an
`.interrupted` marker yet its 79-segment manifest also contained ENDLIST.
Cross-user adoption used ENDLIST/coverage as completion evidence without the
interruption check already present in the ordinary same-user reuse path.
Separately, foreground adoption/heartbeats did not revoke a producer's delayed
supersede stop, so a source shared with a real viewer could still be killed.

Fixes:

- Reuse selection skips interrupted producers, including a death during the
  adoption wait. Normal completed compatible windows remain reusable.
- Adoption cancels the producer's scheduled stop immediately. A viewer
  heartbeat cancels it too; new schedules and timer callbacks respect fresh
  viewer leases. Normal leave/lease expiry and admission ceilings still apply.

## Mobile engine adjustment

Apple mobile prefers the existing native HLS branch when available, even if
ManagedMediaSource makes hls.js supported. Other browsers retain their previous
path; unsupported native HLS still falls back to MSE. iPad desktop UA is covered.
Web Audio/canvas sampling is disabled on the native path to avoid tainted-media
silence. This is a compatibility change requiring real iPhone retesting, not
proof that MSE alone caused the reported loop.

The current source also emitted duplicate timestamps in local packet/decode
inspection; no blanket timestamp rewrite, re-encode or subtitle shift was
introduced on the basis of that observation.

## Validation

Regression coverage checks interrupted ENDLIST rejection, valid completed
reuse, far-seek rejection, real-FFmpeg viewer registration revoking a scheduled
stop, Apple mobile/iPad detection and native pipeline sampling safety.
Run complete backend/frontend suites, frontend production build and archived
runtime integrity checks before deployment. Retest the same film over 4G/5G
after reload; do not infer 100-viewer support from these short samples.

Endpoint/compatibility references:
[Cloudflare speedtest](https://github.com/cloudflare/speedtest),
[hls.js compatibility](https://github.com/video-dev/hls.js#compatibility).
