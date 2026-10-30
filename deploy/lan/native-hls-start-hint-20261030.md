# Native HLS initial destination — 2026-10-30

The user measured about 5–6 seconds for a Safari seek after the 91fbee4
fractional buffer-floor fix. This follow-up reduces avoidable initial segment
fetches; it does not make an unprepared remote movie instantly seekable.

## Implementation and compatibility

Commits 68e3fab and 52f39fb add a playlist-local `start` query to CineVN's native
HLS URL. An authenticated manifest response can then include
`EXT-X-START:TIME-OFFSET=…,PRECISE=YES`, as described in
[RFC 8216 §4.3.5.2](https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.5.2).
The native player can choose the destination segment before its first sample
load, instead of loading the beginning and then handling a JavaScript seek.

Only finite positive covered positions are accepted. Invalid, unavailable or
master-playlist positions are ignored. Decimal syntax is bounded and normalized;
there is no string insertion from an unvalidated request. The exact decoded
position restore remains authoritative. No timestamp, A/V compensation,
subtitle clock, packet duration, mux flag, bitrate or quality changed.

The hint is applied after the cached grant rewrite, separately for each request.
Disk manifests and segment bytes remain untouched. Manifests stay private,
no-store; grant scope/expiry checks and segment Range access remain mandatory.
Requests without `start` retain their old response. MSE does not request the
hint. Existing native app clients remain compatible without an app update.

## Measurements and rejected experiments

The real Endgame origin probe at source position 4084 returned 4080.660000 in
every ABBA trial. Baseline times were 2.228/2.050s; disabling FPS probing gave
2.160/2.118s. There was no material improvement, so production probe arguments
were not changed.

A temporary `hls_segment_options frag_duration` experiment produced an invalid
layout (media in init.mp4 and a 24-byte segment) and decode errors. It was
rejected; no production FFmpeg arguments were changed.

The accepted experiment used identical original H.264/AAC media bytes, three
segments, and two local VOD playlists. In an AVFoundation/AVPlayer probe with
no explicit seek, the hinted playlist began at 12.34s and decoded frames by
the first one-second sample (media clock 13.038s). HTTP logs show the baseline
requested segments 0/1/2; the hinted version requested segment 2 directly.
The short fixture ended normally at about 16.239s. This is an Apple media
engine integration check, **not** a physical Safari/iPhone or 4K benchmark.

## Verification and deployment

CI passed all jobs/steps for 52f39fb:
https://github.com/minhancr123/movie_web/actions/runs/41018166944 .
Backend, frontend/typecheck/build, media integration, baseline timestamp matrix
and deployment checks passed. LAN Node 24.21.0 full backend tests, frontend
checks/build, and the real-controller grant staging test (8 checks) passed.
The LAN tests used an isolated unavailable Redis endpoint rather than the
production store. Isolated previews on loopback ports 5002/3001 were ready,
then stopped before activation.

Both production services now serve
52f39fbf7b725fc7e0d28b5a3e7cb746cdb876a6. All 206 backend and 223 frontend
source blobs matched Git before final verification. Readiness checks passed
locally and through the public site. Rollback configs, activation script,
integrity result and LAN test logs are under
`~/cinevn-deploy-backups/20261030-52f39fbf7b725fc7e0d28b5a3e7cb746cdb876a6/`.

A scoped diagnostic grant verified the actual production session manifest
locally and through cinevn.me: start=12.34 and 6.16 returned the matching tag;
the legacy request returned no tag; child Range returned 206 with 32 bytes;
expired grant plus start still returned 401. Public manifest responses were
private, no-store with Cloudflare DYNAMIC. No diagnostic credential is stored
in this repository or report.

The authenticated IAB restored Endgame at local 6.34s (full-film 68:07), ready
state 4. Its actual 1920×804 dimensions still contradict the 4K badge; this is
not a successful 4K validation. Safari control could not capture the window.
The user was asked for a fresh timed Safari seek: acceptance and the new
end-to-end latency remain pending. Progressive subtitle inventory and real
iPhone seeking are not closed by these tests.
