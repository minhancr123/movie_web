# Review of merge 24ad3c6 and the running deployment

Read-only production inspection at 2026-10-24 07:45 UTC. No deployment or
production source changes were made during this audit. The reviewed Git commit
is `24ad3c679511cfc9a110f193d2345e6ae17d6eda` on
`origin/optimize/perf-20261024`.

## Findings

### P1 — The frontend is not the claimed merged release

Backend `/healthz` reports `24ad3c6`; frontend `/api/health` and public `/release`
report `3a71c7f`. The deployed backend remuxService.js SHA-256 matches 24ad3c6.
The frontend VideoPlayer.tsx in the running runtime directory matches 3a71c7f
exactly and differs from 24ad3c6. This is evidence of mixed deployment state,
not simply two differently named runtime directories.

The frontend runtime directory remains `cinevn-runtime/3a71c7f/frontend`; backend
remains `cinevn-runtime/8be1298/backend-node`. Modifying these directories in
place destroys the useful relationship between a release directory and its
commit. Use immutable directories and activate the tested build explicitly.

### P1 — The merged baseline omits later bilingual fixes

`git log 24ad3c6..3a71c7f` includes:

- `e878206`: Vietnamese preference and sorted subtitle menu.
- `e6409d9`: bilingual default pairing and refreshing BOTH selected tracks.
- `3a71c7f`: configurable English/Vietnamese display order and persistence.
- `4aa8826`: documentation only.

24ad3c6 has its own Vietnamese-first rank implementation, so that particular
behavior is not wholly lost. However, it lacks `bilingualOrder`, the display
order controls, `sortSubtitleMenu`, and the refresh check for the secondary
track. When Vietnamese is an external full-film subtitle and English is an
embedded window, the secondary English window can expire without initiating
the next extraction. Deploying this frontend would remove requested controls.

### P1 — A sliced subtitle file falsely expands its own coverage

`backend-node/services/playback/subtitleInventory.js:83` derives every source's
coverage as filename start + 300 seconds. But trySliceWindowFromCoverage also
creates files containing only partial coverage under the exact same filename
scheme, without storing the actual covered ranges.

Isolated reproduction using the actual merged helper:

1. Only w0 exists; actual coverage is [0,300].
2. Slice w120: returns `{sliced:true, fullCoverage:false}`.
3. Repeat w120 with no new input: returns `fullCoverage:true`.
4. Slice w240: reports it covers the current bucket [240,360], despite no
   extraction or source coverage beyond 300.

The early controller path (`playbackController.js:3417-3420`) discards
fullCoverage, and completed files are accepted without coverage metadata.
This can propagate subtitle gaps across subsequent windows. Store real
coverage separately and propagate it through slices; keep partial status
through readiness and refill paths.

### P2 — Extraction publication is no longer atomic

`backend-node/services/playback/remuxService.js:315` writes directly to
job.outPath. This replaces the previous write-to-temp-and-rename publication,
despite a comment claiming publication remains atomic. Readers can encounter a
truncated or partially written final file, especially while refilling an
already published partial window. Write the filtered content to the temporary
file, then rename it over the final path.

### P1 — Primary-track auto-sync applies the offset in the wrong direction

`frontend/src/components/VideoPlayer.tsx:1146` computes delta as
secondary cue start minus primary cue start. For an embedded secondary reference
and an external primary track, lines 1188 and 1039 add that delta to the primary
lookup time. Correcting the primary requires the opposite sign.

Concrete numeric reproduction using the subtitle lookup helper: external cue
at 197, embedded reference at 200 -> delta +3. The merged primary path displays
the cue at film time 194 instead of 200; it is absent at the correct time.
Test both correction directions and slope mappings before enabling auto-sync.

### P1 — Sync confidence compares a full film against a short window

The auto-sync loop uses all primary cues as its denominator
(`VideoPlayer.tsx:1151`). External subtitles span the film while embedded
subtitles cover five minutes. The track scorer repeats the problem at
lines 1224-1232. Cues outside the available reference window count as mismatches.

Fixture with 1000 full-film cue starts spaced five seconds apart and a perfectly
aligned 60-cue reference window scores 0.062 under the merged auto-sync loop,
below its 0.5 rejection threshold. Restrict matching and confidence to shared
covered intervals, with enough independent matched dialogue evidence; proximity
of cue starts alone cannot establish release identity or lip-sync.

## Verification and limits

- Isolated checkout of 24ad3c6: all 121 frontend tests pass.
- `tsc --noEmit` passes on the isolated merged frontend.
- Targeted backend subtitle-window, coverage and clock tests: 11 pass.
- The additional coverage fixture reproduces the false-coverage condition.
- The numerical clock fixture reproduces the primary-offset direction error.
- Both production services are active. Restart counters are 2/1; these alone
  do not establish ongoing instability or explain the restart causes.

The full backend suite was not repeated in this audit. None of these checks
establishes film dialogue lip-sync, all claimed features, or 100-viewer/4K load
capacity. Existing passing tests do not cover the reproduced defects above.

## Recommended sequence

Merge the latest frontend fixes into the shared optimize baseline, resolve the
coverage/publication and auto-sync defects, add the reproductions as regressions,
then build and deploy that new commit to fresh runtime directories. Verify the
actual backend and frontend release IDs and the public subtitle-order controls.
Use one shared deployment flow; separate working sessions can collaborate
without independently overwriting production directories.
