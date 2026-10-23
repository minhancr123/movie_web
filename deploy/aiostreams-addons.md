# CineVN: addon discovery and direct playback

The LAN instance is separate from playback. It listens only on 127.0.0.1:3100,
uses pinned AIOStreams 2.36.0, a private SQLite directory, a 768 MiB memory limit
and one CPU. Configure `CINEVN_AIO_STATE` and the directory owner's UID/GID when
starting `deploy/aiostreams.lan.compose.yml`. Use `DATABASE_URI=sqlite:///app/data/db.sqlite`.
The container runs as the directory owner with all capabilities dropped.

Generate a credential-free profile with `deploy/aiostreams_profile.py` using the
instance's `/api/v1/status` response. Profiles enable only preset IDs present
and enabled on that instance. TorBox credentials are injected per request by
CineVN; never commit a key, configured manifest, profile header or signed URL.

Set `STREAM_SOURCE_PROVIDER=hybrid`, `AIOSTREAMS_BASE_URL=http://127.0.0.1:3100`
and the private base64 profile in the backend environment. Existing `stremio`
and `aiostreams` modes remain supported. Hybrid starts both discovery paths,
returns shortly after the first usable results, and lets the slower feed finish
warming its own cache. Each request retains its individual timeout. Identical
concurrent searches share work; account-scoped feeds never share credentials.
A failed AIO path has a 30-second cooldown; empty native results cache for 20
seconds instead of hiding a transient outage for ten minutes.

## Addon choices

These are not twenty interchangeable direct-video providers. More addons do not
guarantee more unique MP4 files. Inventory below was checked against the pinned
instance; an available preset is not proof its public upstream is healthy.

| Requested addon | CineVN policy |
|---|---|
| Meteor | Core TorBox metadata search |
| Comet | Core TorBox metadata search |
| STorz | Core `stremthruTorz` preset |
| MediaFusion | Core TorBox metadata search |
| TorrentsDB | Core `torrents-db` preset |
| Torrentio | Core plus independent native fallback |
| Peerflix | Optional preset; enable after measuring useful unique results |
| Sootio | Optional preset; same measurement requirement |
| Knaben | Optional broader search; not needed on every foreground request |
| SeaDex | Optional anime-specific search |
| nekoBT | Optional anime-specific search (`neko-bt`) |
| Library | Optional account-library discovery; not an independent public catalogue |
| WebStreamr | HTTP source; AIO HTTP delivery adapter is not implemented yet |
| HdHub | HTTP source; same adapter limitation |
| PenguPlay | HTTP source; same adapter limitation |
| yastream | Existing dedicated CineVN adapter remains; not silently re-routed through AIO |
| OpenSubtitles V3+ | Subtitle addon, not video discovery; existing subtitle pipeline remains |
| ComeTorz | No matching built-in preset on this instance; requires exact manifest/configuration |
| Debridio | Preset exists; separate subscription/credentials may be required; not enabled |
| ENS | No unambiguous matching preset; requires exact addon/manifest and service identification |

CineVN's torrent path deliberately does not accept arbitrary HTTP URLs from
addon metadata. Enabling an HTTP preset alone will not make its links playable.
An HTTP adapter must enforce URL/redirect and header boundaries, per-account
isolation, browser CORS checks for MSE/HLS, and manifest/segment compatibility
before it can be enabled. AIO is used for discovery, not as a video relay.

## Ranking and recovery

- Validate title/year/episode and device codecs before considering speed.
- Prefer cached availability, preserving the user's Auto quality ceiling and
  explicit source choice. Within equal quality/readiness/HDR/quality-risk slots,
  prefer probed-compatible + Range-checked files, then likely native sources.
- HEVC/Main10, AV1 and WebM hints depend on actual client capability flags.
  AAC/channel/profile and the selected language track still determine delivery.
- Probe height/codec/container/bitrate override filenames. A tiny low-bitrate MP4
  does not displace an adequate source merely because it is direct.
- Codec facts last seven days; Range evidence expires after 30 minutes (negative
  evidence after 30 seconds). The final resolve checks the current URL/origin.
- A verified label means server codec/audio/Range checks passed. It does not
  promise the user's browser, network or a later CDN URL will always work.
- Cold resolution reserves alternatives with a different codec and a lighter
  cached source. Browser recovery excludes failed tokens, keeps the viewing
  position and tries at most three source switches. Manual source choice wins.
- Picker shows up to 30 sources distributed across quality groups, with filters
  for all, probable/verified direct, and processing-required sources.

Reference: https://docs.aiostreams.viren070.me/configuration/options/
