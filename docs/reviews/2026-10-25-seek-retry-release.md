# Seek, retry and release consistency

- Retry only structured `SOURCE_LIST_UNAVAILABLE` responses with `retryable:true`.
  Empty successful listings return `SOURCE_NOT_FOUND`; rejected codecs and titles
  return non-retryable 422 codes. A failed feed cannot invalidate a pinned release.
- Retain the latest-callback ref and held slider target introduced in 4ce7a73.
  The usual parent callback is memoized; callback churn is a robustness case,
  not an independently proven cause of every production stall.
- Preserve the Google iOS code-exchange endpoint recovered from runtime. Do not
  log the Google token response; accept the exchanged audience through server
  request context, not the direct-login request body's audience field. Rate-limit
  code exchange. Shared rendition segments stay public, but manifests authenticate.
- Deploy both services from the same Git archive/full SHA and preserve the active
  900-second window setting. `verify-runtime.mjs` compares archived source to Git,
  checks environment release markers and optionally both live health endpoints.

## Verification

Frontend suite and production build pass. Backend suite passes locally (FFmpeg
integration coverage is completed on the Linux server before activation).

Built-in browser, real VideoPlayer at `/seektest?churn=1`, synthetic local media:
initial EVENT playlist contains 30 seconds of a 600-second title. Parent renders
and changes the callback every 100ms. Seek to 120 using the browser range control:
loading overlay visible and slider stays 120; one resolve; new pipeline starts,
slider advances to 128.4; element time 8.54, paused=false, readyState=4. This tests
intent/coordinate restoration, not real TorBox performance or physical iOS Safari.
A repeatable Playwright regression is included; the interactive verification used
the built-in browser, not the Playwright CLI.

The reported 3–5 seconds on one TorBox title is an observed sample, not a physical
minimum or a universal guarantee. A cached seek still requires transport/decode;
a published rendition may cover a bounded window rather than the entire title.
