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
- Scrub commit freezes the exact cached preview bucket and target. Async
  thumbnail arrival and item handoffs cannot replace the held card with a
  separate spinner/pause-artwork screen. The card includes the loading status,
  then clears after stable progress; a completed manually paused seek can clear
  it without pressing Play. A real episode change discards the old card.
- The player's actual clock still supplies history/progress; preview intent
  does not become a fabricated media position. This is clock/status evidence,
  not a measurement of decoded frame presentation or provider performance.

Verification: 24 executable Swift progress/seek evidence checks and Xcode
simulator build pass. Compile PlaybackProgressEvidence.swift together with
`playback-progress-evidence-tests.swift` using `xcrun swiftc`, then execute.
The SDK's simctl can boot/install, but this host has no Simulator.app UI bundle;
CUA could not open it, so no simulator visual-layout PASS is claimed. Device
archive, installation and real iPhone acceptance are recorded after execution.
