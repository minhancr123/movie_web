# Desktop Safari HLS follow-up — 2026-10-30

The user reported Endgame 4K spinning on the web. Production restoration
snapshots showed the desktop Safari MSE path at readyState 0 with zero buffered
media while the playlist's seekable duration increased. Nginx recorded HTTP 200
for its manifest, init and the first three segments. This rules out a wholly
unreachable server; it does not prove that every media packet or upstream is
healthy. Safari subsequently displayed the bounded-recovery failure message.

Commit `0a8f4e86fef4c3c3966074077b620b498595054f` prefers native HLS for real
desktop Safari, in addition to the existing Apple mobile preference. Chromium,
Edge, Opera and Firefox retain MSE. The existing canPlayType guard still applies.
Native playback also retains the existing protection against unsafe canvas/Web
Audio sampling. No authentication or media grant checks were weakened.

Validation: frontend suites 182 + 4 + 7 tests passed on LAN, typecheck and
production build passed. CI passed:
https://github.com/minhancr123/movie_web/actions/runs/40939903050 .
223 archived frontend Git blobs matched the commit. The isolated port-3001
preview returned the expected release, then was stopped after activation.

Deployment was deliberately frontend-only to preserve active backend remux
workers: frontend serves `0a8f4e86fef4c3c3966074077b620b498595054f`, backend
remains `2e6bc8b08f4a10487b93dab927b5a097ab15250b`. Both local readiness checks
and public `/api/health` passed. This is not a claim that both services run the
same release. The inactive archive contains backend source but is not an
activated backend runtime. Frontend overrides and rollback script are in
`~/cinevn-deploy-backups/20261030-0a8f4e86fef4c3c3966074077b620b498595054f/`.

Physical Safari verification remains pending: the control tool returned an
invalid ScreenCaptureKit parameter when raising the window. An unauthenticated
IAB check could only verify the login requirement, not media playback. The user
was asked to reload the actual Endgame tab and report its result. Neither CI,
HTTP 200, nor switching playback engines establishes that 4K playback is fixed.
The separate iPhone app build 2026103006 also awaits device acceptance.

## Physical failure and follow-up 6ad7dcb

The user reloaded Safari on 0a8f4e8 and reported continuous spinning. That
candidate did **not** pass. New native-path snapshots show HAVE_METADATA,
seeking=true and an empty buffer while the playlist has substantial coverage.

Further checks used session 6c482ecd0276e7d70e73473088531d2e (H.264 High,
1920x804, AAC LC). Public init bytes matched disk. One 9.56 MB public fetch
timed out at 20 seconds; a later complete fetch took 4.012 seconds (19.06 Mbps),
versus 0.107 seconds locally. This demonstrates variability, not proof that
transport alone explains the frozen browser. Both original and edit-list-free
headers played the same media in a local HLS A/B with AVPlayer. The unchanged
public HLS also played in a synchronous AVPlayer/KVO probe: exact seek finished,
clock advanced from 1.5 to 15.64 seconds, and decoded frames were available.
An earlier asynchronous CLI probe did not run a proper main run loop and is
not valid evidence of a media failure. No FFmpeg timestamp/muxing flags changed.

Commit `6ad7dcb27459473bee34714e0bb8df93696b6d03` makes fresh native restoration
wait for initial media data before setting a nonzero exact seek target.
Preload remains active, with no origin pre-roll and unchanged destination
tolerance/readiness checks. The existing covered-target priming path remains
available after assignment. A regression test checks that metadata cannot
interrupt initial decoding or play the origin, and a destination seek still
must complete. Frontend suites/typecheck/build passed locally and on LAN; CI:
https://github.com/minhancr123/movie_web/actions/runs/41005472529 .

223 frontend blobs matched Git before activation. Only frontend was switched
to 6ad7dcb; backend remains 2e6bc8b. Public health reports the new frontend SHA.
Preview port 3001 was stopped afterward. The user was asked to retest Safari;
that result remains pending. The authenticated IAB MSE player was observed
playing with a buffer, but actual dimensions were 1920x804 despite a 4K badge.
This is **not** a successful 4K benchmark; source-quality labeling needs its
own follow-up. Intermittent buffering was also observed in this test session.

## Runtime dependency repair

During diagnostics the active backend's node_modules symlink pointed to the
removed 141e688 runtime. Existing process readiness did not detect this broken
restart/import dependency. Production dependencies were reinstalled using the
active release's exact package-lock.json with npm ci --omit=dev, into
`~/cinevn-dependencies/2e6bc8b08f4a10487b93dab927b5a097ab15250b/`.
The active symlink now targets that durable dependency directory outside
runtime pruning. Lock bytes match; mediaGrant imports, scoped diagnostic HLS
requests, and backend readiness succeeded afterward. Backend was not restarted.
No private token, URL query, environment secret or movie media is committed here.


## Slow-seek follow-up 91fbee4 (12:06–12:30 +07)

The user's clarification matters: Safari **does resume automatically after a
wait**, rather than requiring a reload forever. This is a latency failure,
not evidence that every seek remains permanently deadlocked. No claim of
instant seeking or stable 4K follows from this report.

A UI-driven IAB seek to 1347s created session
c30598fa2ed5088d24d2d242c940c20b. Resolve took 9.4s (remux 3.3s, buffer 4.8s).
Measured origin was 1340.84s; playlist EXTINF values began 10.427s, 10.385s.
The required target-local position plus the unchanged 4s runway is 10.16s.
`Math.ceil` raised this to 11s and unnecessarily required the second GOP.
Its file mtime was 4.698s later than the first. Commit 91fbee4 removes only
that integer rounding. The test still rejects a genuinely incomplete 4s
runway; no timestamp, codec, audio or subtitle tolerance changes.

CI 41008058815 passed backend, media integration/timestamp matrix, frontend
checks/build, and deployment tests. Local frontend checks/build also passed.
Local backend verification could not run the media integration tests because
FFmpeg is absent from that shell. LAN verification must use the complete
archive (some backend tests read frontend/deploy files), Node 24.21.0, and an
isolated unavailable Redis endpoint: a test process otherwise stays alive
on the LAN machine's real Redis. An incomplete archive and an unisolated
first attempt are **not** counted as passes.

The public path also adds real transfer latency: a 20,303,106-byte first
segment took 7.424s (21.88 Mbps); a 4 MiB range took 1.069s publicly and
0.081s over LAN. These are samples, not a sustained bandwidth guarantee.
The IAB MSE test had empty-buffer restores even after resolve, so the floor
fix is not proof that all browser transfer/decoder delays are solved.
A bare local HLS fixture sought accurately in IAB Chrome 156; it is not a
physical Safari test. No further muxing flags changed based on that fixture.

LAN verification completed successfully using Node 24.21.0, the full source
archive, and the isolated test Redis setting. Real-media output included
fractional/VFR HEVC maximum PTS error below 2e-12ms and the existing A/V and
subtitle integration assertions passed. The CI run is:
https://github.com/minhancr123/movie_web/actions/runs/41008058815 .

Backend 91fbee4 was then activated with a readiness-checked rollback script.
The isolated 127.0.0.1:5002 preview was stopped first. All 206 archived backend
blobs match Git. Production /healthz reports ready with 91fbee4; frontend
continues serving 6ad7dcb intentionally. Backend restart stops its old writers;
this was not advertised as a zero-interruption hot swap. Rollback and integrity
proof live in ~/cinevn-deploy-backups/20261030-91fbee4bf99b37e91fb3d15253a2afae8bf77cd5/.
The durable dependency link remains outside release pruning.

After rollout, the authenticated IAB video advanced from about 258s to 332.57s,
readyState=4, paused=false, buffered [316.357,408.063]. Actual dimensions remain
1920x804, so this only verifies ordinary playback, not 4K or the physical
Safari seek latency. The user was asked for one new timed Safari seek;
acceptance and full end-to-end latency improvement remain pending. Temporary
local fixture server and private diagnostic grant URL files were removed.
