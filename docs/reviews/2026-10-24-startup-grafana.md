# Startup, seek and Grafana verification — 2026-10-24

Backend deployed: `57fa6875c515f843c2f65987c010bc6df26fb534`.
Includes `b1a11ec0b834c48c570c7ace59f3c5b17b2080d9`.
Frontend was not changed or redeployed.

## Changes

- Cold seek buckets reduced from 30 to 4 seconds. The readiness floor now
  covers the requested frame plus a segment, measured from the actual origin.
- Fast writers may start with 8 seconds instead of 12; unmeasured/slow writers
  retain the configured buffer. Persist this target for subsequent polling.
- Complete short EOF tails pass both readiness and manifest checks.
- Opt-in `REMUX_INITIAL_BURST_SECONDS=8` on LAN FFmpeg 9.0.2. Copied video
  reads the initial media allowance before returning to `REMUX_READ_RATE=2`.
  The allowance is capped at 12 seconds and excluded from video transcoding.
- Client latency histograms use `schema="latency-v2"`. Dashboard, local rules
  and existing Grafana Cloud alert select the same schema, so incompatible
  retained bucket layouts are not combined. Added 10-minute sample counters.
- Cloud rule retained its sample guards, 5-minute pending period and existing
  CineVN email contact. Local Prometheus configuration and four rules validated.

## Evidence and limits

Same pinned source, request 1019 seconds: old response origin 989.155 with
4.004 seconds available; new origin 1015.181 with 8.008 seconds available.
Resolve times were 8.19 and 8.951 seconds respectively. This establishes
target coverage, not a first-frame speed improvement.

Before/after burst at 1339 seconds: media available in 8.613 versus 6.885
seconds, both with 8.008 seconds of media. The after response did not reuse a
published rendition. Metadata/network cache and sequential test order remain
confounders; this is not a controlled production A/B test. A different cold
target, 1939 seconds, took 6.666 seconds with 12.012 seconds of media.

These are API/manifest/segment availability measurements, not decoded-frame
timings. User confirmed faster opening but still reported slow seeking after
both releases. Two client seek observations after the final deployment summed
to 18.915 seconds; too few samples for a stable p95. Remote source setup and
remux startup still take several seconds. Do not claim instantaneous cold seeks.

Backend suite passed locally and on LAN, including actual FFmpeg A/V offset
checks on LAN. Frontend tests: 118 passed; frontend production build passed.
Backend readiness matched the deployed SHA, service restart count stayed zero,
public homepage returned 200, public `/metrics` returned 404. Prometheus was
ready; remote write pending and failed samples were zero at verification.

## Temporary benchmark incident

A diagnostic command redirected its manifest but initially retained the old
segment output template, overwriting three cached segments of an earlier seek.
The benchmark was stopped. All three segments were regenerated at the original
seek, audio selection and video codec; replacement required a byte-identical
initialization fragment. One existing cache copy was repaired and the session
was preserved. No matching published copy was present. Diagnostic scripts and
failed temporary repair artifacts were removed. Do not reuse a live FFmpeg
argument vector without redirecting **every** output into an isolated folder.

## Histogram follow-up

The Cloud warning returned when two process lifetimes occurred within one rate
window, even with identical bucket boundaries. Schema v3 adds a process-generation
label, then aggregates rates across generations. Zero-valued series for all four
modes are exposed before observations arrive. This also allows the first real
observation after an initial scrape to contribute to increases. Dashboard and
alert selectors migrate together to v3; older samples remain retained.
