# Playback source identity and VIP labels — 2026-10-30

After reporting faster seeks with backend `52e1209`, the user found the playing
badge disagreed with the chosen source, sometimes marking two sources active.

Three independent causes were reproduced and corrected:

1. Frontend matching discarded torrent file indices and Vimo episode suffixes.
   The old test even expected file index 1 to match index 0. Matching now retains
   the file/type/episode; legacy numeric `:0` aliases only `:index:0`. An unknown
   bare torrent hash cannot identify a particular pack file. One matched object
   is selected for highlighting, so equivalent duplicate rows do not all light up.
2. The badge counted unsorted sources, while menus sort Vietnamese subtitle
   matches first and apply delivery filters. Both now obtain VIP ordinals from
   the same complete sorted groups. A filter hiding VIP 1 cannot rename VIP 2.
   Resolve responses are authoritative about the playing token, even outside a
   named fallback; an unknown listing match no longer invents “VIP 1”.
3. A real picker-to-resolve round-trip rejected `hash:unknown:avengers endgame
   (2019) imax.mkv`: the picker generated it, but the resolve regex rejected its
   spaces and silently parsed it as an automatic selection. Bounded spaced and
   Unicode filenames now round-trip. Controls, provider delimiters and overly
   long filenames remain rejected. Existing torrent-wide decoder-failure vetoes
   remain conservative; UI matching does not reuse that broader recovery rule.

Regression tests cover file aliases, distinct pack indices, provider types,
episodes, duplicate rows, server corrections, sorted/filtered VIP ordinals, and
picker-generated source tokens. Local frontend suite: 199 passed, typecheck
passed; backend token regression passed after first reproducing the dropped pin.
No timestamp, segment, bitrate, audio/subtitle-clock or seek policy changes.
The previously withdrawn native start hint must remain explicitly disabled in
the production frontend build. CI and production verification are recorded with
the rollout; passing unit tests alone is not visual Safari acceptance.

## Rollout and acceptance

- [CI 41080334055](https://github.com/minhancr123/movie_web/actions/runs/41080334055)
  passed backend, frontend/typecheck, build, media integration, historical
  timestamp matrix and deployment tests for `2a4b51c`.
- LAN frontend/backend previews became ready before activation; 431 source
  files matched Git. Build ran at low priority on two CPU cores. Packaging
  rejected a dependency on an older runtime, then rebuilt with isolated
  dependencies and included Sharp's locked runtime dependency closure. Both
  Next and Sharp resolve inside standalone; a native Sharp PNG check passed.
- Frontend and backend now report `2a4b51c`; public Endgame page and health
  return HTTP 200. HTTP reuse remains enabled, the native start hint explicitly
  disabled. No FFmpeg writers were active immediately before restart.
- IAB control was unavailable and native Safari subsequently failed screen
  capture, so no screenshot is claimed. The user reloaded, selected a source,
  reopened the list and explicitly confirmed: **the VIP label matches and only
  one source is marked playing**. The earlier seek improvement was also
  user-reported; neither is a calibrated iPhone or 4K benchmark.
- Guarded rollback, service configs, source/build/preview/deployment evidence
  and the standalone packaging helper are retained privately under
  `~/cinevn-deploy-backups/20261030-2a4b51cf5c0d20ea2d8cc3798271d5de434083fd/`.

No merge or iOS installation was performed. Progressive subtitle inventory,
the physical iPhone seek benchmark, and the documented FFmpeg 6.1 upstream
fMP4 HLS non-boundary seek limitation remain outside this acceptance.
