# Resume and buffer consistency

Native source: ~/Documents/CineVN-IOS. Apply resume-buffer-consistency.patch after the season-episode-selection baseline.

- Continue watching explicitly uses the history season, episode and playhead together. Missing episode identity shows a selection error instead of silently opening S1E1.
- Resolve captures season, episode and source token before asynchronous work; successful playback restores the same UI identity.
- Current-item guarded buffer observations use AVPlayer timeControlStatus, with a 450 ms delay before showing transient stalls. Old item observations and superseded seek completions cannot mutate current playback.

Release archive: CineVN-resume-buffer.xcarchive. Real device playback still requires user verification; successful compilation alone does not prove upstream throughput.
