# Source discovery outage — 2026-10-26

The backend was ready, but catalog requests failed before source discovery.
The LAN resolver (router IPv4/IPv6 DNS) answered `api.themoviedb.org` with
127.0.0.1 and ::1. HTTPS then failed hostname verification. The configured
TMDB proxy can fall back to this direct endpoint for ten minutes, extending
an otherwise transient proxy failure. Cached catalog pages still rendered.

Recovery: keep the configured proxy, set the independent fallback explicitly:

```
TMDB_DIRECT_BASE_URL=https://api.tmdb.org/3
```

Authenticated HTTPS requests to this hostname returned the expected TMDB
movie identity. No TLS verification was disabled and no fixed CDN IP was pinned.
The live backend environment and both operator source environment files were
backed up and updated. A backend restart cleared the previous fallback state.

Verification through the running source-list API, as an authorized admin:

| Film | HTTP | Source count |
| --- | --- | --- |
| Interstellar (157336) | 200 | 12 |
| Infinity War (299536) | 200 | 18 |
| Wildwood (791523) | 404 | 0 |

The first two took about eleven seconds each; this verifies discovery recovery,
not playback throughput or a latency improvement. Wildwood remains a legitimate
missing-source result. The frontend must distinguish SOURCE_NOT_FOUND (including
the legacy exact 404 source message) from transient provider/catalog failures.

AIOStreams live selected presets: torrentio, comet, meteor, stremthruTorz,
mediafusion, torrents-db. Background request presets: knaben, peerflix, sootio.
Anime Kitsu is available in the instance preset registry but is not selected in
either profile. No addon configuration was changed during recovery.

On recurrence, check a cold catalog read as well as /healthz. Readiness alone
does not prove external catalog access. Compare resolver results with a trusted
DNS service and inspect the TLS failure before changing provider keys or caches.
