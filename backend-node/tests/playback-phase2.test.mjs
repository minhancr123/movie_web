// Lightweight Phase 2 verification: no network, no DB, no Redis required.
import crypto from 'node:crypto';
process.env.TOKEN_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString('base64')}`;
process.env.REDIS_URL = 'redis://127.0.0.1:6399'; // nothing listening -> cache always misses
process.env.STREMIO_ADDONS = '';

import assert from 'node:assert/strict';
import fs from 'node:fs';

const vault = await import('../services/security/tokenVault.js');
const store = await import('../services/providers/connectionStore.js');
const playback = await import('../controllers/playbackController.js');
const ranker = await import('../services/playback/sourceRanker.js');
const remux = await import('../services/playback/remuxService.js');

/* ------------------------------------------------ tokenVault roundtrip */
const userId = '507f1f77bcf86cd799439011';
const sealed = vault.encryptToken('tb_secret_key_123', { userId, provider: 'torbox' });
assert.equal(sealed.keyVersion, 1);
assert.ok(sealed.iv && sealed.authTag && sealed.ciphertext);
assert.equal(vault.decryptToken(sealed, { userId, provider: 'torbox' }), 'tb_secret_key_123');
assert.throws(() => vault.decryptToken(sealed, { userId: 'other-user', provider: 'torbox' }), 'AAD must bind owner');
assert.equal(vault.fingerprint('tb_secret_key_123').length, 12);
console.log('ok - tokenVault encrypt/decrypt + AAD binding');

/* --------------------------------------- connectionStore with fake db */
const mem = new Map();
const fakeDb = {
  collection: () => ({
    findOne: async (filter) => {
      const all = [...mem.values()];
      // honor the $and/$or shape used by userFilter
      const ors = filter?.$and?.find((c) => c.$or)?.$or || [];
      return all.find((d) => ors.some((o) =>
        (o.userId !== undefined && String(o.userId) === String(d.userId)) ||
        (o.userIdStr !== undefined && o.userIdStr === d.userIdStr))) || null;
    },
    updateOne: async (filter, update, opts) => {
      const key = `${String(filter.userId)}:${filter.provider}`;
      const existing = mem.get(key);
      const doc = { ...(existing || {}), ...update.$set, ...(existing ? {} : update.$setOnInsert || {}) };
      mem.set(key, { _id: key, ...doc });
      return { upsertedId: key };
    },
    insertOne: async (doc) => { mem.set(doc.sessionId || crypto.randomUUID(), doc); return { insertedId: 1 }; },
    deleteOne: async () => ({ deletedCount: 1 }),
    createIndex: async () => 'idx',
  }),
};
await store.saveConnection(fakeDb, userId, 'torbox', {
  plaintextKey: 'tb_secret_key_123',
  profile: { providerUserId: 'u1', email: '', plan: '2' },
});
const loaded = await store.getDecryptedKey(fakeDb, userId, 'torbox');
assert.equal(loaded.key, 'tb_secret_key_123', 'stored key decrypts for owner');
assert.throws(() => vault.decryptToken({ ...sealed }, { userId, provider: 'wrong' }), 'wrong provider fails');
const pub = store.toPublicStatus(await store.getConnectionDoc(fakeDb, userId, 'torbox'));
assert.equal(pub.connected, true);
assert.ok(!('ciphertext' in pub) && !('apiKey' in pub), 'public status leaks no secret');
assert.equal(store.toPublicStatus(null).connected, false);
console.log('ok - connectionStore save/decrypt/status (no secret leak)');

/* ---------------------------------------------------------- file picking */
const files = [
  { fileId: 1, name: 'Show.S02E04.1080p.WEB-DL.mkv', path: '/Show.S02E04.1080p.WEB-DL.mkv', size: 2e9 },
  { fileId: 2, name: 'Show.S02E05.2160p.WEB-DL.mkv', path: '/Show.S02E05.2160p.WEB-DL.mkv', size: 1e9 },
  { fileId: 3, name: 'Sample.mkv', path: '/Sample.mkv', size: 5e9 },
];
const picked = playback.pickBestFile(files, { season: 2, episode: 5 });
assert.equal(picked.fileId, 2, 'episode match beats larger sibling/sample');
assert.equal(playback.pickBestFile([], {}), null);
console.log('ok - pickBestFile episode-aware + sample rejection');

/* --------------------------------------------- sanitize (no URL/hash leak) */
const dirty = {
  infoHash: 'ABCDEF1234567890ABCDEF1234567890ABCDEF12',
  magnet: 'magnet:?xt=urn:btih:ABCDEF&tr=http://evil',
  label: '1080p WEB-DL H.264 5.1 8GB',
  resolution: 1080, codec: 'h264', score: 42, reasons: ['a'],
};
const clean = playback.sanitizeCandidateForResponse(dirty);
assert.ok(!('magnet' in clean) && !('infoHash' in clean) && !('label' in clean) && !('url' in clean));
console.log('ok - sanitizeCandidateForResponse strips magnet/hash/label');

/* ------------------------------------------------------- ranker + remux */
const ranked = ranker.rankCandidates([
  { infoHash: 'a'.repeat(40), label: '1080p WEB-DL H.264 8GB', sizeBytes: 8e9, cached: true },
  { infoHash: 'b'.repeat(40), label: '2160p HEVC REMUX 60GB Dolby Vision', sizeBytes: 60e9, cached: false },
], { hevc: false, maxHeight: 1080 }, { runtimeMinutes: 120 });
assert.equal(ranked.best.infoHash, 'a'.repeat(40), 'cached H.264 beats unplayable HEVC DV');
assert.ok(ranked.rejected.length >= 1, 'HEVC/DV rejected for non-HEVC client');
const direct = remux.decidePlaybackMode(
  { format: 'mov,mp4', video: { codec: 'h264' }, audio: [{ codec: 'aac' }] }, { hevc: false },
);
const remuxed = remux.decidePlaybackMode(
  { format: 'matroska', video: { codec: 'h264' }, audio: [{ codec: 'dts' }] }, { hevc: false },
);
const rejected = remux.decidePlaybackMode(
  { format: 'matroska', video: { codec: 'hevc' }, audio: [] }, { hevc: false },
);
assert.equal(direct.mode, 'direct');
assert.equal(remuxed.mode, 'remux');
assert.equal(rejected.mode, 'reject');
const multiAudio = remux.decidePlaybackMode(
  { format: 'mov,mp4', video: { codec: 'h264' }, audio: [{ codec: 'aac', streamIndex: 1 }, { codec: 'dts', streamIndex: 2 }] }, { hevc: false }, 1,
);
assert.equal(multiAudio.mode, 'remux', 'non-default audio forces remux');
assert.equal(multiAudio.audioStreamIndex, 2, 'remux maps the chosen audio stream');
const fallbackAudio = remux.decidePlaybackMode(
  { format: 'mov,mp4', video: { codec: 'h264' }, audio: [{ codec: 'aac', streamIndex: 1 }] }, { hevc: false }, 5,
);
assert.equal(fallbackAudio.mode, 'direct', 'out-of-range audio falls back to default');
console.log('ok - ranker prefers playable cached + ffprobe direct/remux/reject');

/* ------------------------------------------------------- ownership + routes */
assert.equal(playback.isSessionOwner({ userIdStr: userId }, userId), true);
assert.equal(playback.isSessionOwner({ userIdStr: userId }, 'someone-else'), false);
assert.ok(String(playback.buildSessionId()).length >= 16);

/* --------------------------------------- duplicate resolve serialization */
assert.equal(
  typeof playback.withPlaybackResolveLock,
  'function',
  'same-title resolves need a backend lock that survives React remounts',
);
const resolveOrder = [];
let letFirstFinish;
let firstEntered;
const firstEnteredPromise = new Promise((resolve) => { firstEntered = resolve; });
const firstCanFinish = new Promise((resolve) => { letFirstFinish = resolve; });
const firstResolve = playback.withPlaybackResolveLock('viewer:movie:1', async () => {
  resolveOrder.push('first:start');
  firstEntered();
  await firstCanFinish;
  resolveOrder.push('first:end');
  return 'first';
});
await firstEnteredPromise;
const secondResolve = playback.withPlaybackResolveLock('viewer:movie:1', async () => {
  resolveOrder.push('second:start');
  return 'second';
});
await new Promise((resolve) => setTimeout(resolve, 20));
assert.deepEqual(resolveOrder, ['first:start'], 'duplicate resolve must wait for the active resolve');
letFirstFinish();
assert.deepEqual(await Promise.all([firstResolve, secondResolve]), ['first', 'second']);
assert.deepEqual(resolveOrder, ['first:start', 'first:end', 'second:start']);

await assert.rejects(
  playback.withPlaybackResolveLock('viewer:movie:error', async () => {
    throw new Error('expected');
  }),
  /expected/,
);
assert.equal(
  await playback.withPlaybackResolveLock('viewer:movie:error', async () => 'released'),
  'released',
  'a failed resolve must release its lock',
);
console.log('ok - duplicate playback resolves serialize and failed resolves release');

const serverSrc = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
assert.ok(serverSrc.includes("app.use('/api/providers'"), 'server.js mounts providers');
assert.ok(serverSrc.includes("app.use('/api/playback'"), 'server.js mounts playback');
const dbSrc = fs.readFileSync(new URL('../config/database.js', import.meta.url), 'utf8');
assert.ok(dbSrc.includes('provider_connections') && dbSrc.includes('playback_sessions'), 'mongo indexes added');
const ctrlSrc = fs.readFileSync(new URL('../controllers/playbackController.js', import.meta.url), 'utf8');
assert.ok(!/console\.log\([^)]*(inputUrl|apiKey|debridKey|downloadUrl)/.test(ctrlSrc), 'no secret in logs');
assert.ok(!/enqueueJob/.test(ctrlSrc), 'no queue payload to leak into');
console.log('ok - ownership checks + server wiring + no-leak guards');

console.log('All Phase-2 playback assertions passed.');
process.exit(0);
