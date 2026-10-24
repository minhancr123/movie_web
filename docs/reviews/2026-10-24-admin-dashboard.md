# CineVN admin dashboard

## Implemented

- Six tabs: overview, accounts, movie requests, playback sessions, TorBox provider, settings; existing premiere management linked from the header.
- Replaced hard-coded online count, growth, CPU/RAM and request rate with measured MongoDB counts, host/process measurements and a bounded 60-second process-local HTTP/5xx window. Session counts are explicitly unexpired records, not live viewers. Overview refreshes every 30 seconds while visible.
- Account list has literal text search, role filter and bounded pagination. Playback session list supports unexpired/all filters and pagination. Both use allowlisted projections; credential hashes, provider keys and playable URLs are excluded.
- TorBox status and key replacement reuse existing encrypted provider APIs. No key is read back or stored in browser storage.
- Hover-trailer updates now invalidate the cached boolean immediately.
- Catalog request limit is validated (integer 30–3000), persisted in MongoDB and actually applied by the catalog middleware. Other workers refresh within ten seconds; playback/asset limits remain independent. Settings page documents the scope.
- Configuration changes are recorded with actor/time in an admin audit collection; latest 50 entries displayed.
- Authenticated admin gate on page and admin middleware on every private API, no-store responses, explicit loading/error/empty states, no success message after a failed write. Lists are informational; account role changes, deletions and session termination are not exposed.

## Validation

Backend full test command passed locally (FFmpeg-dependent checks skip where tools are absent). Five new tests cover rolling-window expiration, safe limit values, pagination/operator-shaped inputs, literal regex escaping and data projection allowlists. Frontend's 131 tests and production build passed. Production acceptance is performed separately before reporting deployment.

## App landing images

The preceding static artwork change is commit 0965e0d. It adds real TMDB poster, backdrop and episode-still assets to illustrative phone screens, with explicit illustration/attribution caption. Desktop and phone-size browser inspection showed loaded images and no horizontal page overflow. The deployed landing HTML currently matches the tracked file; backend/compiled frontend release IDs may still reflect the previous release until the combined deployment.

## Deployed acceptance

Application release `0b2cdc177721697603d6012992ab1464c8367d58` is running on both backend and frontend, with zero automatic service restarts at activation. It incorporates the shared branch's newer subtitle/fullscreen changes via fd19bc0; the following 0b2cdc1 commit only updates the subtitle-name test contract for opaque IDs.

Linux backend full suite passed including the HEVC Main 10 decoded-frame remux check. The merged frontend suite (131 tests) and production build passed. Actual running admin API acceptance: stats/users/sessions/settings/audit all return 401 anonymously, 403 for a member, and 200 for an admin; five invalid catalog limits rejected. Real setting persistence/readback was tested at the existing value 120, without changing its effective value. Public `/api/admin/users` returns 401 without credentials.

User opened `/admin` on Brave. Native UI inspection confirmed account list with 20 records, overview with live Mongo/Redis/resource/traffic data, provider panel showing connected shared TorBox with masked key, and movie-request filters/empty state. Settings controls and current limit were visible; no browser key or setting mutation was performed. Intermittent macOS capture failures prevented finishing interactive search and every tab's visual check; these paths were covered by API checks above.
