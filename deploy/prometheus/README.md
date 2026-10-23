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
