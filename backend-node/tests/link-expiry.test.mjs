import assert from 'node:assert/strict';
import { isLinkExpiryDeath } from '../services/playback/remuxService.js';
import { dropDownloadUrl } from '../services/debrid/torbox.js';
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

// torbox.js opens a Redis connection on import; release it so the runner exits.
cacheClient.disconnect();
