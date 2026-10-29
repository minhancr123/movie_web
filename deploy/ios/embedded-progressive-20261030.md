# iOS embedded playback and progressive inventory — 2026-10-30

The Swift project is `/Users/minhancr123/Documents/CineVN-IOS` (not a Git repository).
`embedded-progressive-20261030.patch` preserves this task's changes relative to
its private pre-edit backup. Apply with `patch -p1` from the project root only
after comparing the target files. Never apply historical patches blindly.

## What changes

- New native clients explicitly opt into embedded sources in the picker. The
  backend only offers a title/year/TMDB/IMDb-matched Nguon C player when native
  source discovery finds no playable sources. Old clients keep native URLs.
- `POST /playback/embedded` resolves the exact selected title/episode and token;
  no arbitrary URL input. Only HTTPS `embed<number>.streamc.xyz`, no credentials
  or nonstandard ports. DNS/public-address validation remains enabled.
- AVPlayer handles Direct/HLS. A separate ephemeral WKWebView handles embedded
  players, without app tokens, a JS bridge, shared cookies, popups, custom URL
  schemes or navigation to unrelated hosts. Embedded controls/subtitles belong
  to the provider; native seeking, bilingual subtitles and AirPlay are not
  promised for this transport. Loading UI describes page loading, not decoded
  video readiness. It times out rather than spinning forever.
- Missing-source errors offer a movie request with exact TMDB/type and optional
  season/episode; network/auth/quota failures retain their separate meaning.
- Native AVFoundation decoder failures use bounded alternate-source recovery,
  preserve the pending position, prefer a ready alternative codec, exclude
  failed token aliases, and never pass an embedded page to AVPlayer. Network
  failures and temporary decoder pressure do not enter this path.
- Native subtitle inventory consumes per-owner progressive snapshots, keeps
  manual choices (including Off), receives ready tracks independently of slow
  addons, cancels superseded subscriptions and ignores stale generations. It
  can fall back to the legacy subtitle endpoint during a rolling deployment.
  Nullable URLs for pending embedded tracks now decode correctly.

## Backend contract

`POST /playback/subtitles/inventory` responds immediately with `kind=inventory`,
`jobId`, `version`, `done`, `tracks`, `audio`, `probe`, `match`, `note`, `pending`.
`GET /playback/subtitles/job/:jobId` returns full, versioned snapshots;
`DELETE` retires that owner's subscription only. All authenticated routes use
private/no-store responses. Foreign jobs return 404. Ready shared extraction
is not killed when a viewer leaves. Producer cancellation aborts per-request
sidecar sockets; global/per-user limits, retention and a 120s deadline bound
work. Ready tracks remain usable when a provider fails or the deadline expires.
The legacy POST and legacy job response remain supported.

## Verification and limits

New Node tests cover a real HTTP fixture: cached embedded English and fast
Vietnamese appear while a second subtitle provider is held open, then the
job completes. They also exercise ownership, cancellation, socket closure,
limits, timeout, exact-film/episode matching, URL restrictions, safe errors
and the legacy contract. Mandatory CI media checks include these tests.

Native policy/API harness: copy `embedded-progressive-policy-tests.swift` to
`main.swift` in a temporary directory, compile with Movie.swift,
EmbeddedPlaybackPolicy.swift and NativePlaybackFailurePolicy.swift using
`xcrun swiftc`, then execute. This is a code/contract test, not a device benchmark.

A simulator build and signed device archive are separate checks. They do not
prove playback, provider availability, subtitle alignment, or 4K performance.
Physical iPhone Safari Interstellar 12:00 seeking was still failing on 05f852b;
141e688 introduced web decode failover but has no confirmed physical PASS.
The new native behavior and embedded provider need physical-device acceptance.

Local full backend/media tests on 2026-10-30 encountered a missing FFmpeg binary
(the previous temporary toolchain no longer exists). This is not a passing
media result. Ubuntu CI and the LAN FFmpeg toolchain must supply that evidence.

## Provider observation

The known public Quỷ Móc Mắt player opened in the in-app browser on 2026-10-30
returned Cloudflare “Sorry, you have been blocked.” No challenge was bypassed.
The iOS transport now stops loading and offers a movie request on an HTTP error;
source existence is not proof of playable media. This film is **not** accepted
as working on iPhone until tested there.

The LAN inactive release passed the full backend suite and mandatory media
integration with Node 24.21.0 / FFmpeg n9.0.2 before activation.
