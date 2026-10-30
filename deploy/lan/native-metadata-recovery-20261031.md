# Safari S1E6 metadata-only restore — 2026-10-31

Code: `284f898b0421f7480e649a2a80a7fa2b7971967e`.
This is distinct from the S1E1 ten-minute boundary fixed in `c1e921f`.

## Observed Safari state

The user's screenshot is TV 213331 S1E6, with the display stuck at 0:19 and a
loading spinner. Correlated native-engine telemetry at 02:48–02:49 UTC+7:

- Requested absolute position 27s, reused session origin 19.686s.
- Target local time 7.314s; actual local time remains 0.
- readyState 1, bufferedEnd 0, seekable/duration 904.392s.
- Both paused and attempted-playing snapshots occur without decoded progress.

The displayed 0:19 is the session origin, not evidence that Safari decoded and
played nineteen seconds. The existing complete playlist is available; this
state does not establish an upstream outage or PGS crash.

Native position restore intentionally waits for initial decoder data before
seeking, to avoid the previously reproduced WebKit seek-at-metadata failure.
On this loader, initial data never arrives. A timeout that merely resolves the
same source/session again repeats the same native-loader conditions.

## Recovery change

At restore timeout, a metadata-only native HLS loader with zero buffer, no
explicit media error and supported MSE can rebuild this source through hls.js.
The source-scoped override disables another native-to-MSE switch for that URL.
The existing pipeline checkpoint, requested target, seek lock and captured
play/pause intent survive. This is a recovery path, not proof that the native
decoder or source media has been repaired.

Unsupported MSE, decoded/buffered media, no metadata and explicit decode errors
retain their existing recovery/failover paths. The existing bounded parent
retry policy remains in effect. The platform's native Web Audio restriction is
retained, so changing loader does not enable a new audio-effects graph. Loader
changes refresh telemetry so subsequent snapshots identify the actual engine.

## Checks / limits

Full local frontend suite and typecheck pass. Added regression checks cover
the metadata-only switch, no repeated switch once in MSE, unsupported/error/
decoded cases, exact checkpoint preservation and both play/pause intentions.
Actual native Safari validation is pending: native computer use fails with
ScreenCaptureKit -3811 / computer-use -10005. No physical Safari/iPhone success
is claimed from unit tests or Chromium/MSE observations.

[CI 41118914554](https://github.com/minhancr123/movie_web/actions/runs/41118914554)
passes backend, media/timestamp matrix, frontend tests/typecheck/build and
manifest/deployment tests. LAN build/preview and 223 frontend Git blob checks
pass. Frontend/public health reports `284f898`; backend PID was preserved.
Rollback/evidence is saved in
`~/cinevn-deploy-backups/20261031-284f898b0421f7480e649a2a80a7fa2b7971967e/`.
