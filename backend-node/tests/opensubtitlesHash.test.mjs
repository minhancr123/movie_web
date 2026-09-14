import http from 'node:http';
import assert from 'node:assert/strict';
import { computeOpenSubtitlesHash } from '../services/playback/opensubtitlesHash.js';

const CHUNK = 65536;
const MASK = (1n << 64n) - 1n;

/** Reference implementation over an in-memory buffer (no HTTP, no ranges). */
const reference = (buf) => {
  let h = BigInt(buf.length);
  for (let i = 0; i < CHUNK / 8; i++) h = (h + buf.readBigUInt64LE(i * 8)) & MASK;
  const tailStart = buf.length - CHUNK;
  for (let i = 0; i < CHUNK / 8; i++) h = (h + buf.readBigUInt64LE(tailStart + i * 8)) & MASK;
  return h.toString(16).padStart(16, '0');
};

/** Minimal range-capable static server, like a debrid direct link. */
const serve = (buf) =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
      if (!m) {
        res.writeHead(200, { 'content-length': buf.length });
        return res.end(buf);
      }
      const [start, end] = [Number(m[1]), Number(m[2])];
      const slice = buf.subarray(start, end + 1);
      res.writeHead(206, {
        'content-range': `bytes ${start}-${end}/${buf.length}`,
        'content-length': slice.length,
      });
      res.end(slice);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

const cases = [
  { name: 'toàn số 0, đúng 128 KiB', buf: Buffer.alloc(CHUNK * 2, 0x00), expect: '0000000000020000' },
  { name: 'toàn 0xFF, 128 KiB', buf: Buffer.alloc(CHUNK * 2, 0xff) },
  { name: 'ngẫu nhiên 300 KiB', buf: Buffer.from(Array.from({ length: 300 * 1024 }, (_, i) => (i * 7 + 13) & 0xff)) },
];

for (const c of cases) {
  const server = await serve(c.buf);
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/video.mkv`;

  const got = await computeOpenSubtitlesHash(url, c.buf.length);
  const want = reference(c.buf);

  assert.equal(got.videoSize, c.buf.length, `${c.name}: size`);
  assert.equal(got.videoHash, want, `${c.name}: hash khớp bản tham chiếu`);
  if (c.expect) assert.equal(got.videoHash, c.expect, `${c.name}: khớp giá trị tính tay`);
  assert.match(got.videoHash, /^[0-9a-f]{16}$/, `${c.name}: định dạng 16 hex`);

  console.log(`  OK  ${c.name.padEnd(26)} -> ${got.videoHash}`);
  server.close();
}

// Guard: too small must return null, never a bogus hash.
const tiny = await serve(Buffer.alloc(1000));
assert.equal(await computeOpenSubtitlesHash(`http://127.0.0.1:${tiny.address().port}/x`, 1000), null);
console.log('  OK  file quá nhỏ                 -> null');
tiny.close();

// Guard: a server that ignores Range must throw, not silently pull the file.
const noRange = await new Promise((resolve) => {
  const s = http.createServer((_req, res) => {
    res.writeHead(200);
    res.end(Buffer.alloc(CHUNK * 2));
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
await assert.rejects(
  () => computeOpenSubtitlesHash(`http://127.0.0.1:${noRange.address().port}/x`, CHUNK * 2),
  /range request/,
  'server bỏ qua Range phải báo lỗi'
);
console.log('  OK  server không hỗ trợ range    -> throw');
noRange.close();

console.log('\nTất cả assertion đều pass.');
// No process.exit() here: exiting while the just-closed servers are still
// draining trips a libuv assertion on Windows, and the non-zero exit code then
// breaks the npm-test chain even though every assertion passed.
