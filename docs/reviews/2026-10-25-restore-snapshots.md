# Bounded restore snapshots for slow native seek

User confirmed Wi-Fi after cellular quota ran out. The reported seek was
approximately 14:45 (885s). Backend resolved a new window in 6.1s, then reused
it in 0.7s and 0s. Client seek completion counters remained zero and no media
error was emitted: server resolve duration alone cannot locate the remaining
wait inside native playback.

While the existing restore gate remains pending, collect at most three
snapshots at 2/8/20 seconds per source. Include only engine enum, element
readiness/network state, local target/current time, actual duration, end of
seekable/buffered ranges and paused/seeking booleans. Owned telemetry auth,
rate limiting, bounded numeric validation and event dedup remain in effect.
Never include URLs, headers, tokens, arbitrary messages or user identity.
Cancel timers on source teardown; successful restores stay quiet. These
snapshots do not increment success/failure/rebuffer counters.

This is diagnostic instrumentation, not another claimed seek fix. Retest once
on Wi-Fi to distinguish target coverage from seek/frame completion before
changing playback behavior again. No cellular or synthetic bandwidth test is
required.
