# One iOS loading presentation

Apply after accurate-seek-preview.patch.

Resolving a far seek, restoring its local position and AVPlayer buffering now drive a single loading indicator with stable wording. The overlay appears after 350 ms and disappears only after all three states remain clear for 500 ms. Superseded transitions cancel their delayed presentation update. Pending seek intent is published so the overlay cannot disappear merely because the resolve API returned before playback restored. Errors retain their existing error presentation.

This changes presentation coordination, not upstream throughput. Archive/export: CineVN-loading-state. Real playback verification is still required.
