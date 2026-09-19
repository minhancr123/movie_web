# e2e fake remux origin

Test-only media + server that mimics a filling remux for seek tests.
Never shipped (segments gitignored, harness route 404s in production).

## Regenerate segments (10 min testsrc, 100 x 6s .ts)

ffmpeg -y -v error -f lavfi -i testsrc=duration=600:size=640x360:rate=10 \
  -f lavfi -i sine=frequency=440:duration=600 \
  -c:v libx264 -preset ultrafast -g 10 -pix_fmt yuv420p -c:a aac \
  -f segment -segment_time 6 e2e/media/segs/seg%03d.ts

Encode straight lavfi→ts (NOT via mp4): mp4 edit lists break hls.js
demux (bufferAddCodecError) in tests.

## Run

node e2e/media/server.mjs 5099   # :5099, keep alive (detached)
npm run test:e2e                  # needs frontend :3000 running

Media tests run on the `brave` project: Playwright's bundled Chromium
ships without H.264/AAC, so MSE rejects every real segment there.
