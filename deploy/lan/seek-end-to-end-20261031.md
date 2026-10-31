# End-to-end seek investigation, 2026-10-31

Backend release: `73b9ce5c4fa4637996ca67478eb3439b21d4cc47`.
Frontend remains `65b93f1a1cbb1bd5a874bfc033caa8141abc3ce5`.
Full code CI: https://github.com/minhancr123/movie_web/actions/runs/41166557377

## Scope and result

Real production browser testing used movie 42246 (Tom and Jerry: The Fast and the Furry). These observations are not a physical Safari/iPhone benchmark and are not an identical-source, identical-network controlled before/after comparison. Instant playback is NOT achieved.

Previously observed seeks took 8.693s, 11.239s and 9.635s from intent to first target frame. Backend response duration alone omitted manifest, segment download, demux/append and rendering.

After this release, a seek to 2147s that previously returned 404 succeeded. Observed event offsets from seek intent:

| Event | Milliseconds |
| --- | ---: |
| Commit / resolve start | 653 |
| Resolve end | 5430 |
| Session ready / manifest received | 5538 |
| First target fragment buffered | 6077 |
| Target decode ready | 6095 |
| First target frame rendered | 6102 |

The backend logged 4.5s: discovery/ranking 0s, prepare 1.1s, link 0.2s, remux 2.5s, startup buffer 0.5s (rounded phase values). The UI later advanced to 50:44; it was paused and navigated home before closing the test tab. Screenshot `/tmp/cinevn-owned-pin-seek-verified.png` is a paused final observation, not proof of uninterrupted playback.

The telemetry label `first_target_segment_received` currently comes from Hls.Events.FRAG_BUFFERED. It includes processing/append and must not be interpreted as a pure network-download timestamp.

## Fixed: a valid pin disappeared from addon discovery

An exact pinned file could disappear from refreshed addon results even though an unexpired, previously served session still identified it. That produced a 404 during seeking.

`ownedPinnedSource.js` reconstructs candidate metadata only from an unexpired previously served session matching owner, content, provider, media type, episode and exact canonical source identity. It does not restore signed URLs, credentials or magnets. Current entitlement checks, codec/title checks and actual provider file/link preparation still execute. Ambiguous legacy bare hashes remain discovery-only. It cannot manufacture a missing provider file or bypass an unavailable CDN.

Ten real saved sessions for movie 42246 reconstructed ten exact canonical identities. Unit tests cover isolation, expiration, identity mismatch and credential exclusion. Full backend tests passed on LAN; isolated preview was healthy; source hashes matched git. Backend-only activation checked for active FFmpeg writers, preserved the frontend process, and verified the new health release. Deployment record: `~/cinevn-deploy-backups/20261031-73b9ce5c4fa4637996ca67478eb3439b21d4cc47/deployment.json` on LAN.

## Delivery bottleneck, independent of resolve

The same existing immutable 4,804,258-byte media segment was requested using short-lived session-scoped grants. No grant or signed source URL is retained in this report.

| Path | Observed transfer time |
| --- | ---: |
| Backend loopback on LAN server | 0.032–0.033s |
| Mac via encrypted SSH forward to backend | 0.083s |
| Mac via encrypted SSH forward to nginx | 0.073s |
| Public cinevn.me from Mac | 9.20–9.33s |
| Public cinevn.me from server | 0.615s once, about 9.05s later |

Slow public samples delivered approximately 4.2 Mbps, below the selected source's approximately 6.2 Mbps average. This establishes a delivery-path concern; it does not identify which network/operator is responsible or prove deliberate throttling. nginx configuration validation passed and no configured limit_rate/proxy_limit_rate/limit_req/limit_conn directives were found.

Server health after testing: all three services active, backend health release 73b9ce5, approximately 10.4 GB RAM available and 121 GB filesystem free. These snapshots do not constitute a concurrency capacity benchmark.

## Rejected experiments (not deployed)

1. Cloudflared HTTP/2 transport pilot: identical segment requests took 0.697s, 9.074s and 9.060s, with DYNAMIC cache status. No consistent improvement. Removed the temporary drop-in and restored the prior default transport; backend/frontend were not restarted by this trial.
2. hls.js progressive loading: controlled localhost transfer at 512 KiB/s using the same real 10.01s fMP4 segment. Whole-segment first target frame 9.560s; progressive 9.412s. No useful improvement, so frontend configuration was unchanged.
3. FFmpeg internal 500ms fragment experiment: HLS output moved payload into a roughly 4.81 MB init file and left a 24-byte segment. Rejected. Production FFmpeg arguments, timestamps and segment format were unchanged.

## Upstream observations and remaining work

The TorBox API remained reachable while TCP connections to specific source nodes nexus-230 and nexus-270 timed out from both Mac and LAN. DNS answered promptly. This is evidence about those paths/files, not a global TorBox outage.

Seven MP4 candidates were found for this title, four advertised cached. One cached 1080p H.264/AAC candidate was prepared successfully, but its resulting nexus-230 download URL timed out during ffprobe. It has not been proven playable; MP4 alone cannot fix an unreachable upstream.

Next useful experiment is a measured alternate delivery route and/or provider-supported CDN selection, with the same segment/source and repeated samples. TorBox documents account CDN selection under Integration Settings: https://support.torbox.app/en/articles/10199645-torbox-cdn-hyperdrive . No account CDN setting was changed here. Never replace signed-link hostnames by guesswork.

Physical Safari/iPhone seek verification, long uninterrupted playback and progressive subtitle inventory remain pending. Do not infer their completion from this release, CI, or the lab experiments.
