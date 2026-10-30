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
