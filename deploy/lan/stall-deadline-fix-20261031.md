# Bounded no-progress recovery — 2026-10-31

Code release: `5c9f664dc001da1c85b2a39eaf9e6c268975b08b`.

## Confirmed defect

`VideoPlayer.armStallTimer` previously cleared/restarted the timer and its
position baseline on every call. In addition to real time advancement, calls
come from `waiting`, `playing`, `canplay` and `play`. Repeated readiness events
with a frozen media clock could therefore keep postponing recovery indefinitely.

The new shared deadline only renews an existing timer when the progress path
explicitly reports advancement. Repeated readiness events cannot reset either
the local loader-retry deadline or the escalated parent-recovery deadline.
Progress after recovery rearms the ordinary deadline; pause/source cleanup
cancels it. Existing 15s local and 25s escalated intervals and bounded parent
resolve attempts are retained. These are timers, not guarantees under browser
background throttling or a blocked event loop.

## Reproduction / regression coverage

Deterministic frozen-clock fixture with readiness events every 1s:

| At the 15s deadline | Old unconditional rearm | Fixed deadline |
| --- | ---: | ---: |
| Recovery callbacks | 0 | 1 |

The fixture reproduces the previous unconditional clear/rearm behavior, not a
physical browser freeze. Tests also exercise the 15s + 25s escalation under an
event storm, genuine progress renewal, pause/cleanup, and resume. The existing
spinner tests remain present; seven media-buffering/deadline tests pass.
Full local frontend tests and typecheck passed.

## Deployment evidence

- [CI 41114368211](https://github.com/minhancr123/movie_web/actions/runs/41114368211)
  PASS: backend, media/timestamp matrix, frontend tests/typecheck/build and
  manifest/deployment tests.
- LAN build, contained Next/Sharp runtime and private frontend preview passed;
  223 tracked frontend source files matched their Git blob hashes.
- Frontend activation and public `/api/health` report `5c9f664`. The backend PID
  was verified unchanged by activation. Rollback configuration and deployment
  evidence are in `~/cinevn-deploy-backups/20261031-5c9f664dc001da1c85b2a39eaf9e6c268975b08b/`.
- Live browser validation is blocked: the existing in-app browser tab and a
  rebind both fail with `browser.user is unavailable`. No successful playback
  or ten-minute soak test on this release is claimed.

## Scope and remaining work

This fixes a demonstrated way that loading can remain indefinitely. It does
not establish why the user's separate film initially stalls around ten minutes,
nor resolve the black-picture/harsh-audio report. The user said the affected film
is different from the currently open Endgame tab and will provide its link.
Do not present a normal Endgame smoke check as reproduction of that failure.

Deployment targets frontend only. Backend `e3082b8`, its writers, source URLs,
timestamp/audio/subtitle recipe and window settings are retained. No iOS app
changes are included. Physical iPhone benchmark and progressive subtitle
completion remain pending.
