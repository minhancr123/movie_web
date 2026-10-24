# Vietnamese subtitle selection: Apothecary Diaries S01E01

## Reproduction

CineVN TV 220542, season 1 episode 1. Playing source: The Apothecary Diaries S01E01 MULTi 1080p BluRay x265 Opus -Tsundere-Raws.mkv. Audio: French/Japanese. Embedded text tracks: two French ASS streams; current extracted window contains 3 signs cues and 68 dialogue cues respectively.

The first two Vietnamese online responses returned HTTP 200 but yielded zero cues in the player's VTT/SRT parser. Both indexsubtitle alternatives named 3198776 and 3199021 yielded 299 cues and the same alignment statistics in the sampled window: 60 matched boundaries, match rate 0.821918, offset +0.156s, residual spread 0.0515s. They are not identical text files; timing evidence does not establish translation quality or lip sync.

## Changes

- Validate readable Vietnamese candidates, including when no English embedded track exists.
- Choose a sufficiently populated embedded reference, excluding sparse signs streams; prefer English only when cue counts tie.
- Keep current readable, confidently aligned or file-matched Vietnamese; replace empty candidates or unproven candidates when confident evidence exists.
- Keep automatic evidence-based selection automatic, rather than calling the manual-pick path that persists it and disables further improvements.
- Preserve the validated automatic choice on subsequent inventory updates, allowing exact-file Vietnamese to supersede it.
- Refresh the chosen non-English reference when moving between subtitle windows.
- Request the existing bounded embedded inventory after playback reaches 5 seconds, so Settings need not be opened to trigger comparison. Extraction remains the existing server-side windowed job.
- Viewer manual choices and saved preferences remain authoritative. No hard-coded subtitle ID, account preference, or episode exception.

## Validation

Frontend: 131 tests passed; production build passed. New behavior tests cover French dialogue versus sparse English signs, empty/unknown responses, confident improvement, preserving readable/exact-file choices. Read-only production subtitle API returned HTTP 200; the new selector, run against the actual returned cues, chose the populated French reference and a confidently aligned Vietnamese candidate. This checks returned media data and selection logic, not a claim of visual lip-sync confirmation in the user's browser.

Frontend-only release; backend remains at its existing release. No database account or playback preference was changed during QA.
