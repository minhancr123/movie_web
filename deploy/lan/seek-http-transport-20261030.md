# Endgame seek: isolated HTTP transport experiment — 2026-10-30

Production was unchanged throughout these measurements: backend `52f39fb`,
frontend `6ad7dcb`, 900-second window, read rate 2, initial burst 8 seconds.
The native start hint remains withdrawn. This candidate is opt-in and defaults
OFF (`REMUX_HTTP_KEEPALIVE=1` to enable on a controlled backend); these results
are not an acceptance result from physical Safari or a 4K source.

## Where time went

Real native-player traces contained the following milliseconds since seek:

| Resolve complete | Session ready | Target decode ready | Target frame reported |
| ---: | ---: | ---: | ---: |
| 5695 | 5703 | 7820 | 7824 |
| 8669 | 8676 | 13906 | 13912 |
| 10356 | 10359 | 13909 | 20373 |
| 6940 | 6945 | 9108 | 9119 |
| 6429 | 6435 | 9136 | 9141 |

There is substantial producer/resolve time, then a separate client readiness
cost. The 6464ms decode-to-frame gap in one trace is unexplained; it must not be
silently assigned to TorBox or reported as improved. Native network subphases
are not available in these traces. A user's 5–6 second estimate does not make
every measured seek 5–6 seconds.

## Same real source, same destination

Endgame source fingerprint `1a4a9892819f`, H.264 1920×804, six-channel audio
encoded to AAC. This is not 2160p, irrespective of the page's quality badge.
Writer input seek 6336s, measured timeline origin 6334.662s, requested 6339s;
local target 4.338s. Completion means playlist head >= local target + 4 seconds.
All successful runs reached 9.676 seconds of published media. Time excludes
the independent origin probe, provider discovery, and Safari's own startup.

Initial-burst ABBA-style trials at 8/12/20/8 seconds took
4.232/4.510/4.562/4.584 seconds to the required runway. Larger bursts did not
help, so they were rejected. The 20-second diagnostic override was never a
production setting; the application still caps that option at 12 seconds.

The HTTP test changes only persistent requests and a bounded 1 MiB short-seek
readahead threshold, using options documented by
[FFmpeg's HTTP protocol](https://www.ffmpeg.org/ffmpeg-protocols.html#http).
It changes no timestamp, codec, audio, seek, mux or segment argument.

| Trial | Existing transport | Reuse + 1 MiB | Existing transport repeat |
| --- | ---: | ---: | ---: |
| Initial HTTP comparison | 4.845s | 3.769s | 4.851s |
| Repeat with extra rejected candidate | 5.186s | 3.998s | 4.798s |

An additional `initial_request_size` option was slower (4.452s) and is omitted;
it would also introduce a newer-toolchain dependency.

The committed reproducible runner then performed an ABBA trial with the actual
`buildFfmpegArgs` opt-in, FFmpeg n9.0.2 and Node 24.21.0 on LAN:

| Order | Reuse | Init / first segment | Required runway | Connections | Sampled max RSS |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | Off | 3.974s | 4.904s | 6 | 88 MiB |
| 2 | On | 3.335s | 3.726s | 4 | 78 MiB |
| 3 | On | 2.313s | 3.048s | 4 | 78 MiB |
| 4 | Off | 3.482s | 4.144s | 6 | 88 MiB |

All runs made six HTTP requests. The four target frame hashes were identical:
`6de273a60ef010088b594bb89c220fce`. The roughly 1.1s difference in mean producer
time is promising, not proof of a sub-3-second end-to-end seek. Samples are
small, network conditions vary, and local source metadata was already probed.
RSS is sampled, not a memory capacity or multiuser load guarantee.

## Direct Play inventory

For the same account-scoped Endgame lookup: 60 discovered, 54 playable,
51 cached; playable containers comprised 45 MKV, 6 MP4, 3 unknown. Five cached
1080p MP4 candidates have low-bitrate quality warnings and unverified audio;
the remaining 2160p MP4 was uncached. None was already verified for Direct Play.
Three cached MP4 probes without adding a torrent returned account `not_found`.
Their actual compatibility is therefore **unverified**, not proven impossible.
No quality guard was weakened and no automatic downgrade was introduced.

## Safety and reproducibility

- `npm run test:seek-transport --prefix backend-node`: real ranged-HTTP fixture
  compares exact packet PTS/DTS/duration/payload and decoded frames for H.264
  and HEVC Main10; exercises encoded/copied audio and `Connection: close`.
- Backend full suite passed on LAN with Node 24.21.0 / FFmpeg n9.0.2. CI runs
  the same new test on Ubuntu 24.04 / FFmpeg 6.1, plus the existing frontend,
  typecheck, build, media/timestamp and deployment checks.
- `npm run benchmark:seek-transport --prefix backend-node`: provide private
  `SEEK_BENCH_INPUT`, `SEEK_BENCH_START`, `SEEK_BENCH_ORIGIN`, `SEEK_BENCH_TARGET`
  and optionally `SEEK_BENCH_AUDIO_INDEX`; origin must come from measurement,
  not an assumed bucket. Four bounded isolated runs, automatic media cleanup.
- The runner prints no URLs, provider credentials or raw FFmpeg logs. It
  rejects missing runway, failed decode, and differing destination frames.
- Inputs on disk and video transcodes keep their existing transport. Copy
  sessions retain pacing, window size and media-grant behavior. Rollback is
  the opt-in disabled, not a timestamp or tolerance change.

Sanitized raw results: [seek-http-20261030.json](evidence/seek-http-20261030.json).
Physical Safari acceptance, true 4K behavior, progressive subtitle inventory
and the iPhone seek benchmark remain pending; this experiment closes none of
those acceptance criteria.
