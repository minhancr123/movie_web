import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { remuxWindowSeconds, pricedRemuxSeconds, completedSessionCovers, budgetedWindowSeconds } from '../services/playback/remuxWindow.js';
import { buildFfmpegArgs, estimateSessionBytes, admitRemuxDisk, sessionPath, spawnBeatsReuse } from '../services/playback/remuxService.js';
import { publishRendition } from '../services/playback/renditions.js';

assert.equal(remuxWindowSeconds(false, { PLAYBACK_REMUX_WINDOW_SECONDS: '600' }), 0, 'old clients keep full-film delivery');
assert.equal(remuxWindowSeconds(true, { PLAYBACK_REMUX_WINDOW_SECONDS: '600' }), 600);
assert.equal(remuxWindowSeconds(true, {}), 0, 'feature is opt-in');
assert.equal(remuxWindowSeconds(true, { PLAYBACK_REMUX_WINDOW_SECONDS: '99999' }), 900);
assert.equal(pricedRemuxSeconds(7200, 600, 1100), 600);
assert.equal(pricedRemuxSeconds(7200, 600, 7100), 100, 'near EOF prices remaining bytes');
assert.equal(budgetedWindowSeconds(6600, 600), 600);
assert(budgetedWindowSeconds(80000, 600) < 100, 'high bitrate gets a shorter chunk');
assert.equal(budgetedWindowSeconds(500000, 600), 0, 'an oversized minimum chunk is rejected');
const chunkBytes = estimateSessionBytes({ kbps: 8000, durationSeconds: pricedRemuxSeconds(10000, 600), height: 1080 });
assert(admitRemuxDisk({ freeBytes: 12 * 1024 ** 3, needBytes: chunkBytes }).admitted);
assert(!admitRemuxDisk({ freeBytes: 12 * 1024 ** 3, needBytes: estimateSessionBytes({ kbps: 8000, durationSeconds: 10000 }) }).admitted);
assert(completedSessionCovers(900, 600, 1123), '18:43 exists inside 15:00 chunk');
assert(!completedSessionCovers(900, 100, 1123), 'a finished 16:40 prefix cannot answer 18:43');
assert(!completedSessionCovers(900, 600, 1500), 'next chunk request must not reuse the previous end');
assert(!completedSessionCovers(900, 600, 800), 'seek backwards needs earlier bytes');
assert(!spawnBeatsReuse({ sessionStartAt: 0, freshStartAt: 92, playableSeconds: 80, minPlayable: 8, headAt: 80, requestedAt: 92 }), 'target 12s past the head: wait for the writer');
assert(spawnBeatsReuse({ sessionStartAt: 0, freshStartAt: 600, playableSeconds: 80, minPlayable: 8, headAt: 80, requestedAt: 600 }), 'far target still spawns a closer window');
assert(spawnBeatsReuse({ sessionStartAt: 0, freshStartAt: 92, playableSeconds: 80, minPlayable: 8 }), 'no head context keeps the old position rule');
const args = buildFfmpegArgs({ inputUrl: 'source', outputDir: '/tmp/window-fixture', video: { mode: 'copy', startAt: 1110 }, windowSeconds: 600 });
assert.equal(args[args.indexOf('-ss') + 1], '1110');
assert.equal(args[args.indexOf('-t') + 1], '600');
assert(args.indexOf('-t') > args.indexOf('-i'), 'limit is on the output, after input seek');
assert.equal(args[args.indexOf('-hls_playlist_type') + 1], 'event', 'fixed timeline, no live edge drift');
assert(!args.includes('delete_segments'));
const burstBase = { inputUrl: 'source', outputDir: '/tmp/window-fixture', readRate: 2, initialBurstSeconds: 8 };
const burstArgs = buildFfmpegArgs(burstBase);
assert.equal(burstArgs[burstArgs.indexOf('-readrate_initial_burst') + 1], '8');
assert(burstArgs.indexOf('-readrate_initial_burst') < burstArgs.indexOf('-i'), 'burst is an input option');
const cappedBurst = buildFfmpegArgs({ ...burstBase, initialBurstSeconds: 999 });
assert.equal(cappedBurst[cappedBurst.indexOf('-readrate_initial_burst') + 1], '12', 'burst has a bounded media allowance');
for (const overrides of [{ initialBurstSeconds: 0 }, { readRate: 0 }, { video: { mode: 'transcode', startAt: 0 } }]) {
  assert(!buildFfmpegArgs({ ...burstBase, ...overrides }).includes('-readrate_initial_burst'), 'opt-out, unpaced and transcode paths do not burst');
}
const id = 'f4'.repeat(16);
const marker = sessionPath(id, '.windowed');
await fs.mkdir(sessionPath(id, '.'), { recursive: true });
try {
  await fs.writeFile(marker, '600');
  assert.deepEqual(await publishRendition({ renditionId: 'a4'.repeat(16), sessionId: id }), { ok: false, reason: 'bounded-window' });
} finally { await fs.rm(sessionPath(id, '.'), { recursive: true, force: true }); }
console.log('OK bounded VOD admission, exact seek coverage, FFmpeg cap and publication guard');
