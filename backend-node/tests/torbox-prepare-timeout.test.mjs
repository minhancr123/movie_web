/**
 * A TorBox request that times out must not cost the viewer their source.
 *
 * Regression: with a pinned release, `attempts` holds exactly one candidate, so
 * a single missed 15s deadline on /torrents/mylist ended the whole torrent path
 * and the resolve answered with a Vietsub CDN stream instead — a different cut,
 * mistimed online subtitles, and a spinner that never resolved on a cold CDN.
 * Three things hold that line now: the list is read from TorBox's cached feed
 * when we already know the infohash is in the account, a transient failure is
 * retried once against that cheap feed, and a cached release lost only to
 * infrastructure is reported as retryable rather than swapped for another
 * source.
 */
import crypto from 'node:crypto';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/movieweb';
process.env.TOKEN_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString('base64')}`;
process.env.REDIS_URL = 'redis://127.0.0.1:6399';
process.env.STREMIO_ADDONS = '';

import assert from 'node:assert/strict';
import fs from 'node:fs';

const torbox = await import('../services/debrid/torbox.js');
const { DebridError, isTransientDebridError, prepareSource } = torbox;

const failures = [];
const check = (name, condition) => {
  if (!condition) failures.push(name);
};

const HASH = 'a'.repeat(40);

/** Minimal /torrents/mylist answer holding one cached, finished torrent. */
const cachedTorrentPayload = () => ({
  success: true,
  data: [
    {
      id: 7,
      hash: HASH,
      name: 'Lanterns.S01E01.1080p',
      size: 1_000_000_000,
      progress: 1,
      download_finished: true,
      download_present: true,
      download_state: 'cached',
      cached: true,
      files: [{ id: 11, short_name: 'Lanterns.S01E01.1080p.mkv', name: 'x/Lanterns.S01E01.1080p.mkv', size: 999_000_000 }],
    },
  ],
});

const jsonResponse = (payload, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => JSON.stringify(payload),
});

/** Records every request and answers /torrents/mylist from `handler`. */
const withStubbedTorbox = async (handler, run) => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    return handler(href);
  };
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = original;
  }
};

console.log('Testing TorBox prepare timeout handling...');

// 1. assumeCached reads the cached feed; the default still forces a re-scan.
{
  const { result, calls } = await withStubbedTorbox(
    () => jsonResponse(cachedTorrentPayload()),
    () => prepareSource('key-abc', { infoHash: HASH, assumeCached: true }),
  );
  const listCall = calls.find((href) => href.includes('/torrents/mylist'));
  check('assumeCached-uses-cached-feed', listCall && listCall.includes('bypass_cache=false'));
  check('assumeCached-no-magnet-add', !calls.some((href) => href.includes('createtorrent')));
  check('assumeCached-still-ready', result.state === 'ready');
  check('assumeCached-keeps-files', result.files?.[0]?.fileId === 11);
}

{
  const { calls } = await withStubbedTorbox(
    () => jsonResponse(cachedTorrentPayload()),
    () => prepareSource('key-abc', { infoHash: HASH }),
  );
  const listCall = calls.find((href) => href.includes('/torrents/mylist'));
  check('default-still-bypasses-cache', listCall && listCall.includes('bypass_cache=true'));
}

// 2. A timeout is a provider that stopped answering, not a verdict on the file.
check('timeout-is-transient', isTransientDebridError(new DebridError('x', { status: 504, code: 'timeout' })));
check('rate-limit-is-transient', isTransientDebridError(new DebridError('x', { status: 429, code: 'rate_limited' })));
check('bad-gateway-is-transient', isTransientDebridError(new DebridError('x', { status: 502 })));
check('not-found-is-not-transient', !isTransientDebridError(new DebridError('x', { status: 404, code: 'not_found' })));
check('bad-request-is-not-transient', !isTransientDebridError(new DebridError('x', { status: 400, code: 'bad_request' })));
check('bad-token-is-not-transient', !isTransientDebridError(new DebridError('x', { status: 401, code: 'invalid_token' })));
check('foreign-error-is-not-transient', !isTransientDebridError(new Error('socket hang up')));

// 3. The timeout itself still surfaces as a retryable, classified failure.
{
  let seen = null;
  try {
    await withStubbedTorbox(
      () => jsonResponse({ detail: 'upstream busy' }, 504),
      () => prepareSource('key-abc', { infoHash: HASH, assumeCached: true }),
    );
  } catch (error) {
    seen = error;
  }
  check('upstream-504-throws', seen instanceof DebridError);
  check('upstream-504-is-transient', isTransientDebridError(seen));
  check('upstream-504-has-no-key', !String(seen?.message || '').includes('key-abc'));
}

// 4. The controller must not reach the Vietsub fallback on that failure.
const controllerSource = fs.readFileSync(
  new URL('../controllers/playbackController.js', import.meta.url),
  'utf8',
);
if (
  !/const hadCachedCandidate = attempts\.some/.test(controllerSource) ||
  !/if \(transientPrepareFailure && hadCachedCandidate\) \{/.test(controllerSource) ||
  !/code: 'SOURCE_PREPARE_TIMEOUT', retryable: true/.test(controllerSource)
) {
  failures.push('controller-refuses-vietsub-fallback-on-transient-prepare-failure');
}
// The guard has to sit BEFORE the fallback, or it guards nothing.
const guardAt = controllerSource.indexOf('if (transientPrepareFailure && hadCachedCandidate) {');
const fallbackAt = controllerSource.indexOf("stage('vimo-fallback')");
check('guard-precedes-vietsub-fallback', guardAt > 0 && fallbackAt > guardAt);
// And a transient failure must be retried, not written off.
if (!/isTransientDebridError\(error\)/.test(controllerSource)) {
  failures.push('controller-retries-transient-prepare');
}

// 5. The client has to act on that code, including for a far seek.
const sectionSource = fs.readFileSync(
  new URL('../../frontend/src/components/PlaybackSection.tsx', import.meta.url),
  'utf8',
);
if (!/SOURCE_PREPARE_TIMEOUT/.test(sectionSource)) {
  failures.push('client-retries-source-prepare-timeout');
}
const retryBranch = sectionSource.indexOf('RETRYABLE_503_CODES.has(code)');
const seekRethrow = sectionSource.indexOf('throw err;', retryBranch);
check('retry-precedes-seek-rethrow', retryBranch > 0 && seekRethrow > retryBranch);
// A retry must not clear its own budget, or it retries forever.
if (!/if \(options\?\.serverRetry !== true\) busyRetriesRef\.current = 0;/.test(sectionSource)) {
  failures.push('retry-counter-not-reset-by-its-own-retry');
}

if (failures.length) {
  console.error(`FAILED: ${failures.join(', ')}`);
  process.exit(1);
}

console.log('ok - a TorBox timeout retries the cached feed and never silently swaps the source');
console.log('All torbox-prepare-timeout tests passed!');
process.exit(0);
