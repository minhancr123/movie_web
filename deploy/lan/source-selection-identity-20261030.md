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
