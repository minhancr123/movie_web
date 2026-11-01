# Correct native HLS master serving

Production backend/frontend: `71e20ebc368e1eb47a0611b07e605a4fdf4d6380`.

Captured the five deployed backend source changes in `766b50e` before editing.
The deployed source was still labelled bf3a62d despite having been edited in
place. Compared 444 source files to the captured snapshot before activation;
no concurrent source changes were found. The new runtime matches all 446
tracked backend/frontend files. Both public health/release endpoints identify
71e20eb. Activation includes restoration of both previous systemd overrides if
readiness fails; backups are in `~/cinevn-deploy-backups/20261101-71e20ebc368e1eb47a0611b07e605a4fdf4d6380/`.

The session master handler formerly called fs.stat on master.m3u8 before its
in-memory generator. A live, authorized remux with an existing index returned
404. Master generation now precedes the nonexistent-file check. Published
sessions read their rendition directory; stable rendition URLs retain their
session-bound authorization. Missing init/index still answers readiness 404.

Output metadata comes from ffprobe of the actual init.mp4: AVC configuration
bytes or HEVC profile/tier/level/compatibility/constraints, AAC object type,
actual output dimensions and known PQ/HLG/SDR transfer signaling. Successful
init probes are bounded and coalesced by path/inode/size/mtime. BANDWIDTH uses
the maximum measured segment byte rate (a conservative upper bound on segment
window rates). No guessed profile, 16:9 width, source resolution after transcode,
10Mbps default, or unverified independent-segment declaration remains.

Frontend native HLS uses master.m3u8 and tries the existing MSE path once on
native error when supported. Rebuilt from the source that retains the actual
DOM callback ref for viewing presence, recommendation badges and admin filters.
Service-worker revision is v7. No accounts, existing sessions or transcode data
were deleted during this repair.

Validation:

- Full backend npm test passed on LAN with isolated Redis URLs and no provider
  credentials. The first packaging attempt omitted deploy/grafana-dashboard.json;
  after including that existing fixture, the full suite passed.
- Full frontend npm test, PWA checks and final production build passed.
- Four codec/output tests include a real FFmpeg 192x80 fMP4 fixture; nine real
  HTTP controller staging checks cover master→index→init/segments on all three
  URL paths, scoped grants, foreign-owner rejection, expiry and private caching.
  Reran the controller test on the exact final code after a path simplification
  regression was caught and corrected before activation.
- Generated accurate masters for eight existing production output sets, including
  H.264/HEVC and non-16:9 resolutions (1920x770, 1920x800, 3840x1600).
- Public production chain: master200, index200, init206, segment206;
  master Cache-Control private,no-store; Cloudflare DYNAMIC.
- Real macOS Safari native video element (no hls.js) played existing production
  HEVC through the new master, readyState4/error0 and time advancing to9.5s.
  Temporary local diagnostic page used only a five-minute scoped media grant;
  test tab/server were closed. No credentials/grants are recorded here.

Limits: physical iPhone not tested. Opening Interstellar in the complete Safari
app hit the existing disk-admission fallback (24GiB filesystem space remained);
this prevented checking that title's main remux through the app in this trial.
The separate native HEVC trial reused existing bytes and started no new writer.
No claim that a missing master was the sole cause of every native error4, or
that disk admission/other codec errors have been solved.
