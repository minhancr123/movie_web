# Playback monitoring on the LAN server

`docker compose -f deploy/prometheus/compose.yml up -d` starts a loopback-only
Prometheus on port 9091, scraping the backend on port 5001 every 30 seconds.
Retention is capped at 7 days / 1 GB. This service has CPU and memory limits.
Nginx must use `deploy/lan/nginx-routes.conf`, which blocks public `/metrics`.
Do not expose port 9091 or backend port 5001 publicly.

Validate before starting:

```sh
docker compose -f deploy/prometheus/compose.yml run --rm --entrypoint promtool prometheus check config /etc/prometheus/prometheus.yml
```

To inspect locally from another computer, use an SSH tunnel:

```sh
ssh -N -L 9091:127.0.0.1:9091 minhancr123@minhancr123.local
```

Import `deploy/grafana-dashboard.json` into Grafana and select the Prometheus
datasource. Grafana Cloud cannot reach this loopback server directly. Configure
an authenticated Grafana Alloy/Prometheus remote_write connection first; keep
its credentials outside Git. Cloud alert delivery/contact points must be
configured separately. The local rules evaluate alerts, but do not send email
without Alertmanager or equivalent cloud alert routing.

First-frame and seek measurements come from authenticated player events;
server resolve duration is a separate metric. Stage polling is read-only.
Rebuffer ratio excludes startup, pause and seek time. These counters are
best-effort telemetry, not billing or exact concurrent-viewer accounting.
No user IDs, media titles, provider keys or signed URLs are metric labels.

Keep `HLS_SEGMENT_SECONDS=4` by default. Changing it to 2 requests shorter
segments, but copy-mode boundaries still follow source keyframes. Compare
first-frame, seek p95 and rebuffer ratios for equivalent sources and devices
before choosing a new default. No real-user A/B improvement is claimed.

## LAN → Grafana Cloud (2026-10-23)

The LAN deployment runs from `~/cinevn-state/monitoring/compose.json`, independent
of application release directories. `prometheus-cloud.example.yml` is the applied
remote-write template. Keep the token outside Git, bind-mounted read-only as
`/run/secrets/grafana-token`; host file owner 1000, group 65534, mode 0640, inside
an owner-only directory. Grafana accepted the email contact-point test notification. The token belongs to `cinevn-lan-metrics` and has only
`metrics:write` for the `dapperunicycle1362` stack. It expires after 90 days;
renew before expiry. Do not expose port 9091 or the backend `/metrics` publicly.

Dashboard: https://dapperunicycle1362.grafana.net/d/cinevn-playback/cinevn-playback-observability

Cloud rule `eg12lk3nay134d` (`CineVN LAN health and playback`) replaces queries
for the previous VPS `cineon_*` metrics with LAN backend health, missing telemetry,
first-frame, seek, failure and rebuffer checks. It evaluates every minute and
requires a violation for five minutes; client latency checks require >=10 events
in ten minutes, failure checks >=3 failures, and rebuffer checks >300 played seconds.
It routes to the existing `CineVN email` contact point. This rule does **not**
monitor disk, backups or host CPU/RAM: those old VPS series are unavailable on LAN.
The local four playback rules remain active locally but have no local Alertmanager.

Verification: local `up{job="cinevn"}=1`, remote-write failed samples=0 and pending=0;
Cloud preview returned `{check="backend-down"}=0`. Client panels may show **No data**
until real viewers send events; that is not proof of zero stalls or 4K capacity.
Before claiming 4K concurrency, test representative bitrate/codec files and actual
outbound throughput. The current remux egress budget is 25 Mbps, with two writers
and video transcoding disabled; direct play bypasses that VPS remux path.
