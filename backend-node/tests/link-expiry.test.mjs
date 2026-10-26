import assert from 'node:assert/strict';
import { isLinkExpiryDeath } from '../services/playback/remuxService.js';
import { dropDownloadUrl, getDownloadUrl } from '../services/debrid/torbox.js';
import { cacheClient } from '../config/redis.js';

// Classic mid-film link death: non-zero exit plus 403 in the stderr tail.
assert.equal(
  isLinkExpiryDeath({
    exitCode: 1,
    stderrTail: '[https @ 0x7f] HTTP error 403 Forbidden for https://dl.torbox.app/x',
  }),
  true,
);
assert.equal(
  isLinkExpiryDeath({ exitCode: 1, stderrTail: '401 Unauthorized' }),
  true,
);
assert.equal(
  isLinkExpiryDeath({ exitCode: 1, stderrTail: 'token expired, please renew' }),
  true,
);
console.log('ok - link-expiry deaths detected');

// Deliberate and clean stops never count, whatever the logs say.
assert.equal(isLinkExpiryDeath({ exitCode: 0, stderrTail: '403 Forbidden' }), false);
assert.equal(isLinkExpiryDeath({ exitCode: null, stderrTail: '403 Forbidden' }), false);
assert.equal(isLinkExpiryDeath({ exitCode: undefined, stderrTail: '403 Forbidden' }), false);
// A failed child WITHOUT the auth smell keeps the old sampling path.
assert.equal(
  isLinkExpiryDeath({ exitCode: 1, stderrTail: 'Connection reset by peer' }),
  false,
);
assert.equal(isLinkExpiryDeath({}), false);
assert.equal(isLinkExpiryDeath(), false);
console.log('ok - deliberate stops and unsmelled failures ignored');

// Cache bust needs real ids: 'auto'-keyed entries belong to someone else.
assert.equal(await dropDownloadUrl({ torrentId: null, fileId: 7, userId: 'u' }), false);
assert.equal(await dropDownloadUrl({ torrentId: 9, fileId: null, userId: 'u' }), false);
console.log('ok - link cache bust refuses unnameable keys');

// A retry must actually reach the provider even while the failed link is cached.
const oldFetch = globalThis.fetch, oldGet = cacheClient.get, oldSet = cacheClient.set;
let requests = 0, saved;
try {
  cacheClient.get = async () => 'https://old.example/video';
  cacheClient.set = async (_key, value) => { saved = value; };
  globalThis.fetch = async () => { requests++; return new Response(JSON.stringify({ success: true, data: 'https://fresh.example/video' }), { status: 200 }); };
  const args = { torrentId: 9, fileId: 0, userId: 'test' };
  assert.equal(await getDownloadUrl('test-key', args), 'https://old.example/video');
  assert.equal(requests, 0);
  assert.equal(await getDownloadUrl('test-key', { ...args, forceRefresh: true }), 'https://fresh.example/video');
  assert.equal(requests, 1);
  assert.equal(saved, 'https://fresh.example/video');
} finally { globalThis.fetch = oldFetch; cacheClient.get = oldGet; cacheClient.set = oldSet; }
console.log('ok - explicit refresh bypasses a cached failed URL and caches the replacement');

// torbox.js opens a Redis connection on import; release it so the runner exits.
cacheClient.disconnect();
