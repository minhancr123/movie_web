# TV 213331 S1E1: bounded-window tail stall — 2026-10-31

Code: `c1e921f4aa4f4f47c8ea483c4b2a037e6ab567c0`.
Affected URL: `https://cinevn.me/xem-phim/tv/213331/bao-thuc-cuong-nhan?s=1&e=1`.

## Reproduced failure

The logged-in in-app browser, using the MSE engine, played the existing HEVC
session `3341fd88…`. We sought to 570s and then let playback advance normally.
This is a boundary reproduction, not a ten-minute uninterrupted-from-zero soak.

The backend session has a **600s** bounded window (adaptive windows can differ
from the configured 900s maximum). Its complete playlist has 604.057s of EXTINF
entries and ENDLIST. At the observed freeze:

| Observable media state | Value |
| --- | ---: |
| Element currentTime | 599.965132s |
| Common buffered range end | 600.021333s |
| Element duration | 604.394s |
| readyState | 2 |
| paused / ended | false / false |
| media error | none |

Local ffprobe of the final packets shows video presentation through 604.394s,
but audio only through 600.243s. Consequently the shared A/V buffered range
stops before the media duration. Waiting for the ordinary `ended` event can
strand playback at the nominal window boundary. This is concrete evidence for
this source/window; it is not evidence of a PGS crash or a TorBox outage.

The prior `5c9f664` bounded watchdog eventually recovered and playback advanced
beyond the boundary, confirming why that mitigation helps but still imposes
an unnecessary recovery wait. Backend logs also show next-window preparation
at about 603s, origin 599.057s, before the stalled handoff.

## Fix

For a stalled, almost-empty shared buffer at the declared bounded-window end,
request the next window at the **exact current absolute position**, rather than
waiting for an `ended` event that may never arrive. The existing prepared-window
adoption path can consume already prepared bytes and retain that exact target.

The guard requires a completed MSE playlist. Native HLS does not expose ENDLIST
through the media element, so its guard requires a finite extent reaching the
declared window, together with the same near-boundary and exhausted-buffer
conditions. User pauses, pending restores/seeks, ordinary mid-window stalls,
usable buffered tails, short incomplete windows and the final content end do
not trigger the new handoff. The bounded watchdog also checks this edge as a
fallback if the original waiting event preceded receipt of the final manifest.

Regression tests use the observed 599.965132 / 600.021333 / 604.394 values and
cover absolute-origin preservation and the excluded cases. Full local frontend
suite and typecheck pass. This change does not modify FFmpeg timestamps, media
bytes, audio/subtitle clocks, backend service or source selection.

## Validation status

Build and isolated frontend preview on LAN pass; 223 tracked frontend files
match their Git blobs. [CI 41116654030](https://github.com/minhancr123/movie_web/actions/runs/41116654030)
passes backend, media/timestamp matrix, frontend tests/typecheck/build and
manifest/deployment tests. Public frontend health reports `c1e921f`; activation
verified that the backend PID did not change. Rollback/evidence are saved in
`~/cinevn-deploy-backups/20261031-c1e921f4aa4f4f47c8ea483c4b2a037e6ab567c0/`.

Post-deploy test on the same episode/source: sought to 570s and played forward.
Before the boundary the element had localTime 592.72537, buffered end 600.230666,
duration 604.603333, readyState 4 and no error. After the handoff the displayed
absolute position was 626.749461, while the replacement element's localTime was
31.192958, readyState 4, paused false and no error. The new common buffer
extended to 126.399999 local seconds. Thus it crossed the previously stuck edge
and continued without waiting for the old watchdog's full recovery sequence.
These are sampled states, not a frame-accurate handoff-latency benchmark.
Playback continued to displayed 12:27 before the temporary test tab was paused.
Browser state samples are saved with the deployment evidence; a screenshot was
saved locally as `/tmp/cinevn-c1e921f-window-handoff.png`.

The in-app browser connection was restored by resetting its stale control
binding and opening a temporary test tab. Physical Safari/iPhone verification
was requested separately; the separately reported startup black-picture/harsh-
audio failure is not proven resolved by this work.
