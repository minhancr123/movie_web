# AIOStreams for CineVN

CineVN can use a private AIOStreams instance as its primary torrent discovery
provider. AIOStreams aggregates Torrentio and Comet; CineVN still validates
infohashes, checks TorBox using the current viewer's connection, probes codecs,
and runs its existing direct/HLS playback pipeline.

## Deployment

Run `sudo bash deploy/aiostreams-pilot.sh` on the production host. The Compose
file pins the official image digest, joins `cineon_cineon`, binds only
`127.0.0.1:3100`, and limits the container to 512 MiB RAM and 0.5 CPU.
Startup gets a 180-second health grace period. Data and its immutable encryption
key are stored under root-only `/var/lib/cineon-aiostreams`.

Run `sudo python3 deploy/aiostreams_probe.py --bounded` for a repeatable comparison.
This creates the private `pilot-multi-config.json`: the existing Torrentio
configuration plus Comet with 15 results per resolution and 150 overall results.
The private stream API is configured for 20 requests per 10 seconds.

Enable the adapter through the host's private `.env`:

```dotenv
STREAM_SOURCE_PROVIDER=aiostreams
AIOSTREAMS_BASE_URL=http://aiostreams:3000
AIOSTREAMS_USER_DATA=<base64 of pilot-multi-config.json>
```

Do not commit the configuration or place debrid account credentials in a shared
profile. This adapter consumes torrent metadata only, discarding provider URLs
and request headers. It deliberately leaves TorBox authentication per viewer in
CineVN. URL-only addons require a separate adapter; the existing Vimo path stays
independent.

The client rejects redirects, bounds responses to 4 MiB, and times out at eight
seconds. Failed/empty responses fall back to `STREMIO_ADDONS`; a 30-second cooldown
avoids repeatedly waiting on an unavailable AIOStreams instance. Redis cache
keys include a hash of the private configuration so profile changes cannot reuse
old search responses.

Setting `STREAM_SOURCE_PROVIDER=stremio` and recreating the backend restores
native addon discovery. The AIOStreams service uses a separate Compose project,
so application deploys do not recreate it. Public dashboard/addon exposure is
not configured; the internal API is the integration surface.

## QuackStart-derived profile

`deploy/aiostreams_quack.py` builds a bounded profile from the existing private
`pilot-multi-config.json`. The reviewed rules in
`deploy/aiostreams/quackstart-rules.json` were retrieved from
[QuackStart](https://duck-tools.pages.dev/quackstart/) on 2026-10-14, including
its quality ranking expressions and strict title/year/episode matching.
The source ranking references the Releases-Regex rules named in that snapshot.

The profile keeps Torrentio and the bounded Comet manifest, adding Zilean,
Knaben and anime-only SeaDex. It caps results at 150 overall, 40 per resolution,
and scraper waits at 3s.
Optional paid scrapers and Usenet are not enabled. Native browser compatibility
and disk admission remain authoritative; release ranking is retained only
inside equal resolution/HDR/readiness groups, after direct-play priority.

Saved `quack-config.json` contains no TorBox key. The backend injects the current
viewer's decrypted key only into the request to the fixed internal AIO peer.
Redis metadata caches and failure cooldowns include the account key's hash in
their scope. Direct links and authorization headers are discarded from replies.
The private AIO service needs `--max-http-header-size=131072` for the larger
configuration header. Its CPU/RAM limits remain unchanged.

Build the operator profile with:

```sh
sudo python3 deploy/aiostreams_quack.py \
  /var/lib/cineon-aiostreams/pilot-multi-config.json \
  /var/lib/cineon-aiostreams/quack-config.json
```

Only after deploying the account-scoping backend should the host's private
`AIOSTREAMS_USER_DATA` be changed to the base64-encoded new profile and the
backend/worker/scheduler recreated. Preserve the previous profile value for
rollback. Production backups include `quack-config.json`; actual account
connections stay in the encrypted Mongo provider-connection records.

The final bounded profile was tested against one connected TorBox account on
2026-10-14. These queries followed earlier pilot calls, so upstream caches were
warm; timings are discovery latency, not playback startup or a cold-cache SLA.

| Sample | Unique cached torrents returned | Search seconds | Source errors |
| --- | ---: | ---: | ---: |
| Insidious | 7 | 1.80 | 0 |
| The Matrix | 99 | 1.96 | 0 |
| Breaking Bad S1E1 | 91 | 1.71 | 0 |
| Dragon Ball Super S1E1 | 31 | 2.03 | 0 |

The Matrix retained 40 4K and 40 1080p rows plus lower-resolution alternatives.
Zilean/Knaben contributed to the movie/series results and SeaDex contributed to
the anime sample. The earlier 5s-per-scraper trial took 6.49–8.26s with transient
source errors; this is why the final profile bounds scraper waits at 3s.

Two additional searches (Oppenheimer and Prison Break S1E1) were run concurrently
with the production 8s request deadline. They completed in 6.04s and 7.02s,
returning 93 and 36 cached torrents respectively. Both had Zilean/Knaben source
timeouts and retained Torrentio/Comet results. This remains a dependency on
external scraper availability, rather than a guarantee of error-free searches.

The live backend was verified on release `1fdfdea` with the credential-free
saved profile and the owner's account-scoped searches: Insidious returned 7
candidates and Dragon Ball Super returned 31, through AIOStreams.

## Operations

When AIOStreams is enabled, the existing monitor checks its container and
`/api/v1/status`; existing Grafana container/probe rules include those metrics.
Production backup includes its private environment, profile, Compose file, and
an online SQLite backup. The SQLite backup incorporates committed WAL changes
and becomes a standalone database. Restore drills check SQLite integrity and
the presence of the 64-character encryption key without touching the live instance.

## Measurements on 2026-10-13

See [the sanitized results](aiostreams-pilot-results.json). Four addon-level samples
were queried twice. Another four samples were queried twice with two concurrent
requests. All bounded AIOStreams searches succeeded without reported source errors.

| Sample | Native addon unique torrents | Bounded AIOStreams + Comet |
| --- | ---: | ---: |
| The Matrix | 99 | 147 |
| Oppenheimer | 105 | 145 |
| Breaking Bad S1E1 | 51 | 109 |
| Dragon Ball Super S1E1 | 37 | 73 |

On the additional concurrent samples, first requests took 1.826–2.521 seconds;
repeated requests took 0.150–0.276 seconds. The bounded instance's observed cgroup
memory peak was about 213 MiB, with no OOM or restart. The initial unrestricted
Comet trial approached 489 MiB and is not the deployed profile.

These are discovery tests, not confirmation that every returned torrent is
cached on TorBox or plays on Safari. Native HTTP comparison bypassed CineVN's
existing Redis cache and ran before AIOStreams, so upstream caches can bias
timings in AIOStreams' favour. The original native adapter caps each addon at
60 rows; the table measures whole addon replies, not source-picker card counts.
The evidence supports broader source discovery; it does not prove faster cold
lookups, smoother playback, or long-term availability of external addons.

Official references: [deployment](https://docs.aiostreams.viren070.me/getting-started/deployment/),
[search API](https://docs.aiostreams.viren070.me/apis/search/).
