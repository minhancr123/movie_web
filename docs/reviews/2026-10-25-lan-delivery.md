# Synthetic LAN delivery check

Production remained on `000745835b8425b9c26ae1d6454f5f8e9f48f9cb`.
No production restart, provider use, user creation or configuration change.
The reusable command is in `deploy/lan/check-delivery-capacity.py`.

Server: existing i5-11400H / 15-GiB LAN host, Ethernet 1 Gbps.
Client: Mac over Wi-Fi en0. Existing private diagnostic Nginx on port 8088.
Warm synthetic files; HTTP byte-range delivery with randomized positions.

| Connections | Mbps each | Achieved Mbps | Range p95 ms | Late / expected | Errors |
|---:|---:|---:|---:|---:|---:|
| 5 | 8 | 40 | 159.11 | 0 / 60 | 0 |
| 10 | 8 | 80 | 230.44 | 0 / 120 | 0 |
| 20 | 8 | 160 | 376.72 | 0 / 240 | 0 |
| 5 | 25 | 125 | 298.34 | 0 / 60 | 0 |
| 10 | 25 | 250 | 582.87 | 0 / 120 | 0 |
| 20 | 25 | 495.2 | 1003.55 | 14 / 240 | 0 |

Each main phase lasted 12 seconds. All 840 requests returned the correct range
and byte count. Fourteen late one-second deliveries are not measured rebuffer
events: there was no browser decoder/player buffer in this experiment.

The 10 × 25-Mbps LAN repeat lasted 30 seconds: 250 Mbps, 300/300 valid
responses, no missed deadline, range p95 562.59 ms. The simultaneous server
loopback comparison at 20 × 25 Mbps returned 500 Mbps with no missed deadline
and p95 11.68 ms. These observations implicate the client/network path at the
highest sampled rate; they do not isolate Wi-Fi versus router/TCP or measure
the Internet uplink.

During the six main phases, 105 server resource samples showed peak aggregate
CPU 4.99%, minimum available RAM 10,294 MiB, minimum free disk 150.2 GiB and
zero backend readiness failures. These are file-delivery results, not four
simultaneous cold remuxes or software 4K encoding.

Keep four writers and the existing quality/cache policies. Measure WAN clients
and real-provider starts/continuations before increasing limits. No evidence
here justifies buying more CPU/RAM for cached file delivery. This does not
certify 100 viewers, arbitrary 4K bitrates, hours of playback, cold disk reads,
subtitle/seek correctness or TorBox throughput. Raw reports are retained in
the operator's private Codex reports directory, outside Git.
