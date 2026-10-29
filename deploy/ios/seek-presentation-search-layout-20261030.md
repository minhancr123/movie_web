# Native seek presentation and search layout — 2026-10-30

Physical user feedback on build 2026103001: Nguon C's Quỷ Móc Mắt player is
blocked on the iPhone too. Interstellar seeking alternates preview/loading;
this is a failed acceptance check, not a completed benchmark. User also
identified excessive vertical blank space around the search category strip.

This incremental Swift patch targets the previous 2026103001 project in
`~/Documents/CineVN-IOS`. It does not change or deploy the backend, FFmpeg,
source selection, subtitle offsets, media timing tolerances or grants.

- The horizontal LazyHStack/ScrollView category strip now has a bounded,
  Dynamic-Type-scaled height (44pt base), single-line intrinsic-width chips,
  and no reserved strip when genres are empty.
- Clock jumps and a single advancing sample no longer settle restoration.
  The native player requires three normal clock advances with AVPlayer's
  timeControlStatus actually playing. A short stable-playback grace avoids
  flickering for isolated buffer-status changes; genuine stalls remain visible.
  New seeks, pause and source resets discard old evidence.
- Preview thumbnails are displayed **only while actively dragging**. After
  release there is one plain loading banner, with the committed target and no
  thumbnail/empty square. The same banner covers item replacement/restoration
  and buffering; late thumbnail replies cannot change it into a picture.
  It clears after stable progress; a completed manually paused seek clears it
  without pressing Play. Pause artwork is suppressed during the committed seek.
- The player's actual clock still supplies history/progress; preview intent
  does not become a fabricated media position. This is clock/status evidence,
  not a measurement of decoded frame presentation or provider performance.

Verification: 24 executable Swift progress/seek evidence checks and Xcode
simulator build pass. Compile PlaybackProgressEvidence.swift together with
`playback-progress-evidence-tests.swift` using `xcrun swiftc`, then execute.
The SDK's simctl can boot/install, but this host has no Simulator.app UI bundle;
CUA could not open it, so no simulator visual-layout PASS is claimed. Device
archive, installation and real iPhone acceptance are recorded after execution.

## Deployment results

- Native code/patch commit: `af1b368`; GitHub Actions full pipeline passed:
  https://github.com/minhancr123/movie_web/actions/runs/40932251473 .
- Xcode simulator build and signed device archive passed. Existing native
  API/codec/source-policy checks also pass (25), in addition to the 24 new
  progress-evidence checks. No simulator media performance claim is made.
- codesign strict verification and IPA export succeeded; installation of
  bundle `com.minhancr123.cinevn`, build `2026103002`, completed on the paired
  physical iPhone. User has been asked to check both category spacing and
  Interstellar seek presentation; acceptance is pending that response.
- IPA: `~/Downloads/CineVN-iOS-Seek-Layout-20261030/CineVN-IOS.ipa`, 2,149,491
  bytes, SHA-256 `38a24d1a61429cf76256f1bf7cbda80a845f21bbda9828664e648b55fa3b4179`.
- Backend remains release `2e6bc8b`; this patch requires no service restart or
  server policy change. No Cloudflare bypass or additional provider was added.

Final review found an item-handoff edge case: reapplying the same target after
softReset could replace the frozen image with nil from the new session's empty
thumbnail cache. Only a new target or an explicit user scrub commit now replaces
that snapshot. Build 2026103003 includes this refinement; 2026103002 was the
initial installation in this task. Physical acceptance is still pending.

## Physical feedback and final presentation revision

The user tested 2026103002 and reported that the preview square remained during
loading and still alternated with the animation. **That attempt did not pass.**
2026103003 was archived during review but was not installed. The final candidate
is 2026103004: the held preview card is removed altogether after release, with
only the plain loading banner rendered. Clock evidence and the compact search
category strip remain. Device acceptance must be checked again on this build.

## Final build 2026103004 evidence

- Native patch commit `e4f9ae388cf7f1413b4512ea2daf700fae84465c` passed the full GitHub Actions pipeline:
  https://github.com/minhancr123/movie_web/actions/runs/40933889615 .
- Signed device archive, strict codesign verification and IPA export passed.
  devicectl acknowledged successful installation on the paired physical iPhone.
- IPA: `~/Downloads/CineVN-iOS-Seek-Layout-2026103004/CineVN-IOS.ipa`,
  2,147,267 bytes, SHA-256
  `beecdfb373a9aa91b4e8775a989a382250d5d89e4086f97b217fe87e672cc72f`.
- User confirmation of seek presentation and category spacing on build 004
  remains pending. Compilation, installation and CI do not prove physical
  playback correctness or TorBox/4K stability. Backend remains `2e6bc8b`.

## Build 004 physical result and build 005 correction

The user confirms category spacing is fixed. Seek presentation on build 004
**failed**: the image alternating with loading is the full movie surface, not
a thumbnail. Removing the thumbnail did not mask intermediate AVPlayer frames.

Build 005 keeps the actual AVPlayer attached and decoding, but places an opaque,
non-interactive black curtain above the video and subtitle layers during a
committed seek. The single loading banner and controls remain above it. The
curtain has no fade transition and is released only after stable clock evidence,
no outstanding target, and no resolver/item handoff in progress. A manually
paused completed seek retains the existing completion path. This is a visual
presentation correction, not an upstream-speed or media-decoding fix.

Physical acceptance of build 005 remains pending.

Build 2026103005 signed archive, strict codesign verification and IPA export
passed. devicectl acknowledged installation on the paired physical iPhone.
The 24 progress-evidence checks pass and the incremental patch applies cleanly
to the saved build-001 source.

IPA: `~/Downloads/CineVN-iOS-Seek-Layout-2026103005/CineVN-IOS.ipa`,
2,147,644 bytes, SHA-256
`b1910908db41896b530a0401caf460acd0e46b99b104d18349c728b4f56698f9`.
The user has been asked to test the full-frame curtain during seek and resumed
playback; no physical PASS is claimed yet.

## Startup follow-up: build 2026103006

Build 005's CI passed (run 40936829745), but the user then reported prolonged
startup buffering on Endgame. This does not establish seek acceptance. Server
resolve took 13.9 seconds for the cold source and 2.6 seconds on reuse; HLS init
and multiple segments returned HTTP 200 to AppleCoreMedia. Cached device
diagnostics were stale because clock callbacks stop during waits. No claim
that TorBox alone caused this failure is justified.

Code review found the first resolve's requested resume position was discarded
when constructing PlaybackContext. Only subsequent replacement sessions held
a restoration target. Build 006 carries the initial request into the first
item-ready callback and explicitly seeks it, including the window start, rather
than allowing an EVENT playlist to choose its current edge. A five-second
independent diagnostic sampler now records item/time-control status, waiting
reason, loaded/seekable ranges and error codes even with a stationary clock.
It stops on engine cleanup; no signed URLs or credentials are recorded.

Build 006 signed archive, codesign verification and export passed; installation
was acknowledged by devicectl. IPA: `~/Downloads/CineVN-iOS-Seek-Layout-2026103006/CineVN-IOS.ipa`,
2,150,574 bytes, SHA-256 `54f29309ef04a3de0091bac8ee74a0415420dfc93113b414b77a4766bb09d88e`.
User was asked to reopen Endgame for a physical measurement. That test and
seek acceptance remain pending; user subsequently asked for a post-reboot
server health check. Category spacing is user-confirmed fixed.
