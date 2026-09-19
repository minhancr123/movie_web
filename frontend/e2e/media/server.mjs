/**
 * Fake remux origin for seek Playwright tests.
 *
 * - GET /slow/index.m3u8  — EVENT playlist WITHOUT endlist whose segment
 *   count grows while the test runs (simulates a filling remux). Query
 *   ?segs=N pins the count; ?growMs=M reveals one more segment every M ms.
 * - GET /full/index.m3u8  — finished VOD (ENDLIST) with every segment.
 * - GET /segXXX.ts         — pre-generated 6s mpegts parts (see gen step).
 *
 * Run: `node e2e/media/server.mjs [port]` (default 5099).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = import.meta.dirname;
const segsDir = path.join(root, 'segs');
const SEG_FILES = fs
  .readdirSync(segsDir)
  .filter((f) => /^seg\d+\.ts$/.test(f))
  .sort();
const SEG_DUR = 6;

const playlist = (count, { endlist }) => {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:EVENT',
  ];
  for (let i = 0; i < count; i += 1) {
    lines.push(`#EXTINF:${SEG_DUR.toFixed(1)},`, `/${SEG_FILES[i]}`);
  }
  if (endlist) lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
};

const startedAt = Date.now();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/slow/index.m3u8') {
    const pinned = Number(url.searchParams.get('segs'));
    const growMs = Number(url.searchParams.get('growMs') || 5000);
    const grown = 3 + Math.floor((Date.now() - startedAt) / growMs);
    const count = Math.max(
      1,
      Math.min(SEG_FILES.length, Number.isFinite(pinned) && pinned > 0 ? pinned : grown),
    );
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.end(playlist(count, { endlist: false }));
    return;
  }
  if (url.pathname === '/full/index.m3u8') {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.end(playlist(SEG_FILES.length, { endlist: true }));
    return;
  }
  // Canned sidecar timed in FULL-FILM coordinates for the subtitle
  // Playwright spec: cue at 8:02 must show when a startAt=480 session plays
  // its local 2s; the 0:02 decoy must NOT (it would show iff the player
  // forgot the session offset), and vice versa for startAt=0.
  if (url.pathname === '/subs/vi.vtt') {
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.end(
      'WEBVTT\n\n00:08:02.000 --> 00:08:06.000\nCAU DUNG TAM PHUT\n\n00:00:02.000 --> 00:00:06.000\nCAU SAI DAU PHIM\n',
    );
    return;
  }
  const file = path.join(segsDir, path.basename(url.pathname));
  if (file.startsWith(segsDir) && fs.existsSync(file)) {
    res.setHeader('Content-Type', 'video/mp2t');
    fs.createReadStream(file).pipe(res);
    return;
  }
  res.statusCode = 404;
  res.end('nope');
});

const port = Number(process.argv[2]) || 5099;
server.listen(port, () => console.log(`fake remux origin on :${port} (${SEG_FILES.length} segs)`));
