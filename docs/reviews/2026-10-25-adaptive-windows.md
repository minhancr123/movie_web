# Adaptive new-window policy for the LAN playback server

## Scope

Opt-in `PLAYBACK_ADAPTIVE_WINDOW=1` chooses 900/600/300-second upper bounds
from occupied writer slots and admission waiters. It never lengthens the
configured window, changes an existing writer, enables a legacy client's
window support, increases writer capacity, or bypasses the bitrate byte cap.
Direct playback and completed-cache delivery remain unchanged.

The cold-start gate uses rendition identity plus seek origin, excluding window
duration. A pressure change between two viewers must not create duplicate
writers merely because the followers chose different window lengths. Adoption
returns the producer's actual duration for correct continuation timing.

## Production configuration

- Four writers, 2x paced reads and 8-second initial burst remain unchanged.
- Maximum configured window remains 900 seconds; adaptive flag enabled.
- Temporary cache 48 GiB; published rendition budget reduced from the implicit
  100-GiB default to explicit 48 GiB; admission reserve increased 12 -> 24 GiB.
- Cache budgets are separate soft janitor limits, not a unified physical quota.
  No manual eviction of viewer files or deletion of database data is involved.

## Acceptance and limits

Tests cover pressure tiers, reservations via writerSlotStatus, opt-out, legacy
mode, configured shorter windows, drain/invalid snapshots and the 4K byte cap.
Run the complete backend suite including the isolated real-FFmpeg queue test on
the LAN host; run frontend tests/build and archived release integrity checks.
The 5/10/20-viewer real-provider load experiment remains separate: synthetic
scheduler tests do not certify TorBox, WAN upload, real-device decoding or 100
simultaneous 4K viewers. Observe continuation frequency and stalls after rollout;
disable the adaptive flag in a new release if continuations regress.
