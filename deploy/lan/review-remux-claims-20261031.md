# Review of reported remux/PGS conclusions — 2026-10-31

Read-only investigation on LAN; production remains `e3082b8`. No writer,
configuration, media cache or provider node was changed. This review does not
claim to resolve Safari decode, pause/resume audio, or long-session buffering.

## Verified observations

Production journal timestamps below use UTC+7. The cited events predate the
`e3082b8` backend restart and must not be described as failures introduced by
the latest pinned-discovery optimization.

| Session prefix | Database context | Start offset | Local HLS result |
| --- | --- | ---: | --- |
| `db1f98b3` | TV 213331, S1E6 | 19.686s | HEVC 1920x1080 + AAC 48kHz; 207 segments, 904.392s, ENDLIST, window marker 900, no interruption marker |
| `06757d3b` | TV 213331, S1E6 | 0s | H.264 1920x1080 + AAC 44.1kHz; 225 segments, 899.972s, ENDLIST, window marker 900, no interruption marker |
| `66d48da7` | TV 213331, S1E1 | 0s | HEVC; 45 segments, 184.011s, ENDLIST, window marker 900, interruption marker `stopped` |

Database comparison of the first two rows: torrent hash, file identifier and
full filename all differ. Thus they are not the same exact input source.
No raw provider URLs, credentials or complete source hashes are recorded here.

Both complete HLS outputs pass local ffprobe and decoding of their first eight
seconds with the installed FFmpeg (exit 0, empty error stderr). This is not
Safari/WebKit compatibility validation and does not cover every segment.

### Timeline of the PGS-associated exit

- 01:19:51: `66d48da7` spawned, HEVC copy / audio encode.
- 01:19:58: S1E1 resolve succeeds, total 10.8 seconds.
- 01:20:24.978: client sends `leave` for that session.
- 01:21:25: writer exits 255; retained stderr includes the PGS metadata warning.
- On disk, `.interrupted` says `stopped`, not `255`.

`stopRemuxSession` writes `stopped` before requesting SIGTERM and removes the
writer from the map. The close handler currently logs *every* nonzero exit as
an error and appends the retained stderr tail, even for deliberate stops. That
can misleadingly pair an old metadata warning with the eventual stop.

Controlled reproduction on the same host/toolchain: a local synthetic H.264
lavfi input, with no subtitle stream, was terminated with SIGTERM after one
second. FFmpeg returned **255**, without any PGS mention. Therefore exit 255
alone is not proof of a subtitle-triggered crash.

The other two writers logged normal completion after approximately 453 and
450 wall seconds. Their outputs contain approximately 900 media seconds,
consistent with paced processing around twice playback speed. A completed
bounded writer need not remain running for viewers to consume its segments.

## What the supplied conclusions overstate

1. Native `MEDIA_ERR_DECODE` at local time 0 is real, but it does not identify
   a corrupt segment, stale session, codec defect or upstream failure by itself.
   The old session in this example ultimately produced a complete local window.
2. The inspected replacement switched HEVC to H.264 and changed both torrent and
   file. It cannot isolate session reuse while holding input media constant.
3. PGS metadata is a suspect only if a fatal failure is demonstrated while an
   active viewer still needs the writer. Here the stop marker, preceding leave
   and SIGTERM reproduction support an intentional stop instead.
4. No active FFmpeg process is normal after a window finishes. It is not proof
   that the CDN or HLS stopped prematurely. These particular windows are 900
   seconds, not five minutes.
5. Buffering in Brave as well as Safari does not uniquely identify the backend:
   they share frontend recovery/window/restore code as well as the server.
6. Audio continuing while video is black does not establish a separate old audio
   element/session. That needs player/render/audio state from the actual failure.
7. TorBox supplied enough data for these outputs; this does not establish that
   TorBox/CDN was healthy at every later failing request.

## Follow-up before changing the media recipe

- Distinguish deliberate stop reason/signal from unexpected exit in diagnostics.
  Do not treat old PGS warning text as the fatal-error cause.
- Correlate actual source/file, session, viewer lease, absolute/local playhead,
  init segment, first requested media segment and player engine in one trace.
- For repeatable reuse failures, compare the same input and target under reused
  and fresh windows, including manifest/segment responses and WebKit decode.
- For the reported ten-minute stall, capture the final playable media boundary,
  writer completion, next-window prepare/adoption and actual HTTP requests. The
  historical logs above do not establish a cause for that symptom.

The current recipe already explicitly maps video and audio and disables output
subtitles. Moving subtitle flags or changing probing globally is not justified
by this evidence and could affect embedded-subtitle extraction. Physical iPhone
benchmark and progressive subtitle completion remain pending.
