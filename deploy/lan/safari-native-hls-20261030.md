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
