import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import {
  buildRenditionId,
  selectRenditionEvictions,
  publishRendition,
  renditionPath,
  RENDITION_FORMAT_VERSION,
} from '../services/playback/renditions.js';
import { sessionPath } from '../services/playback/remuxService.js';

const base = {
  infoHash: 'ABCDEF1234567890ABCDEF1234567890ABCDEF12',
  fileId: 3,
  audioStreamIndex: 1,
  audioCopy: false,
  audioChannels: 6,
  video: { mode: 'transcode', height: 1080, kbps: 8000, tonemap: false, tenBit: false },
  segmentSeconds: 4,
};

// Stable and well-formed.
const a = buildRenditionId(base);
const b = buildRenditionId({ ...base });
assert.equal(a, b);
assert.match(a, /^[a-f0-9]{32}$/);
console.log('ok - rendition id stable, format v' + RENDITION_FORMAT_VERSION);

// Everything that changes bytes changes the id.
assert.notEqual(buildRenditionId({ ...base, audioStreamIndex: 2 }), a);
assert.notEqual(buildRenditionId({ ...base, audioCopy: true }), a);
assert.notEqual(buildRenditionId({ ...base, audioChannels: 2 }), a);
assert.notEqual(
  buildRenditionId({ ...base, video: { ...base.video, height: 720 } }),
  a,
);
assert.notEqual(buildRenditionId({ ...base, segmentSeconds: 6 }), a);
assert.notEqual(buildRenditionId({ ...base, fileId: 4 }), a);
// Case and number/string coercion do not fork identities.
assert.equal(buildRenditionId({ ...base, infoHash: base.infoHash.toLowerCase() }), a);
assert.equal(buildRenditionId({ ...base, fileId: '3' }), a);
console.log('ok - rendition id sensitive to bytes, blind to spelling');

// Copy-mode video collapses to one bucket regardless of extra fields.
assert.equal(
  buildRenditionId({ ...base, video: { mode: 'copy', height: 9999 } }),
  buildRenditionId({ ...base, video: { mode: 'copy' } }),
);
console.log('ok - copy-mode renditions share one id');

// Seek-started sessions hold truncated bytes: same file and settings at a
// different start must never share an id, while startAt: 0 stays identical
// to omitting it (existing cache entries keep working).
assert.notEqual(
  buildRenditionId({ ...base, video: { ...base.video, startAt: 1800 } }),
  a,
  'seek offset forks the rendition id',
);
assert.equal(
  buildRenditionId({ ...base, video: { ...base.video, startAt: 0 } }),
  a,
  'zero offset keeps the legacy id',
);
assert.equal(
  buildRenditionId({ ...base, video: { mode: 'remux', startAt: 1800 } }),
  buildRenditionId({ ...base, video: { mode: 'remux', startAt: 1800 } }),
  'seek + copy ids are stable',
);
console.log('ok - seek offset forks rendition ids without invalidating old ones');

// Eviction: expired first (oldest access first), then LRU over budget.
const rows = [
  { renditionId: 'aa', bytes: 100, lastAccessAtMs: 1000 },
  { renditionId: 'bb', bytes: 100, lastAccessAtMs: 2000 },
  { renditionId: 'cc', bytes: 100, lastAccessAtMs: 3000 },
];
assert.deepEqual(
  selectRenditionEvictions(rows, { now: 10_000, maxBytes: 10 ** 12, ttlMs: 7_500 }).evict,
  ['aa', 'bb'],
);
assert.deepEqual(
  selectRenditionEvictions(rows, { now: 10_000, maxBytes: 250, ttlMs: 10 ** 12 }).evict,
  ['aa'],
);
assert.deepEqual(
  selectRenditionEvictions(rows, { now: 10_000, maxBytes: 10 ** 12, ttlMs: 10 ** 12 }).evict,
  [],
);
assert.deepEqual(selectRenditionEvictions([], {}).evict, []);
console.log('ok - rendition eviction expires then LRU-caps');

// Publish end-to-end against a fake finished session, then clean up.
const fakeSession = 'f'.repeat(32);
const fakeId = buildRenditionId({ infoHash: 'f'.repeat(40), fileId: 1 });
const sessionDir = path.dirname(sessionPath(fakeSession, 'index.m3u8'));
const outDir = path.dirname(renditionPath(fakeId, 'index.m3u8'));
try {
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, 'index.m3u8'),
    '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4.0,\nseg_00000.m4s\n#EXTINF:4.0,\nseg_00001.m4s\n#EXT-X-ENDLIST\n',
  );
  await fs.writeFile(path.join(sessionDir, 'init.mp4'), 'init-bytes');
  await fs.writeFile(path.join(sessionDir, 'seg_00000.m4s'), 'seg0');
  await fs.writeFile(path.join(sessionDir, 'seg_00001.m4s'), 'seg1');

  const first = await publishRendition({ renditionId: fakeId, sessionId: fakeSession });
  assert.equal(first.ok, true);
  assert.equal(first.segments, 2);
  assert.equal(first.duration, 8);
  const served = await fs.readFile(path.join(outDir, 'seg_00001.m4s'), 'utf8');
  assert.equal(served, 'seg1');
  const second = await publishRendition({ renditionId: fakeId, sessionId: fakeSession });
  assert.equal(second.ok, true);
  assert.equal(second.dedup, true);
  console.log('ok - finished session publishes once, serves bytes');

  // Incomplete playlists never publish.
  await fs.writeFile(path.join(sessionDir, 'index.m3u8'), '#EXTM3U\n#EXTINF:4.0,\nseg_00000.m4s\n');
  const badId = buildRenditionId({ infoHash: 'e'.repeat(40), fileId: 2 });
  const bad = await publishRendition({ renditionId: badId, sessionId: fakeSession });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'incomplete');
  console.log('ok - incomplete session refused');
} finally {
  await fs.rm(sessionDir, { recursive: true, force: true });
  await fs.rm(outDir, { recursive: true, force: true });
}
