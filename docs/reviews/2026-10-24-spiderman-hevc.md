# Spider-Man 634649: Safari spinner at 00:00

Deployed backend: `beb32ee1a9172c0d75c790669f20b1db3cc8dc04`, runtime
`/home/minhancr123/cinevn-runtime/beb32ee/backend-node`.

The existing session had a complete five-minute HLS window. Initialization and
first media fragment returned HTTP 200 through cinevn.me, in 239/493 ms in one
server-side check. HTTP readiness therefore did not establish playable video.

The pinned source was HEVC Main 10 SDR, 3840x1608, with TrueHD audio converted to
AAC. The original video decoded; the remux emitted HEVC CABAC/reference-picture
errors. Two isolated remuxes of the same source established that retaining
`filter_units=remove_types=62-63` reproduced the decode errors, while removing it
did not. No active session arguments or output paths were reused for this test.

Removed the unconditional NAL rewrite, kept stream copy and hvc1 tagging, bumped
REMUX_BUILD to 8 and rendition format to 2 so neither old session output nor old
published output can answer new resolves. The bitrate/resolution was preserved.

Validation: complete backend suite passed locally and on LAN. New FFmpeg HEVC
Main 10 roundtrip test passed on LAN, comparing all decoded frame hashes.
Frontend 118 tests and production build passed. Post-deploy resolves used build
8 and a new session. Follow-up decoding of real build-8 fragments no longer
reported the HEVC CABAC/reference-picture failures; the diagnostic null muxer
still reported duplicate output DTS warnings on this variable-timestamp source.
These warnings are not a clean end-to-end playback guarantee. User reloaded the
same Safari film tab and explicitly confirmed that playback worked.
