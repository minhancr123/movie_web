// TMDB resilience: retry what a retry can fix, serve stale cache when it cannot.
// SNI resets fail fast, so attempts 2-3 usually succeed; a dead upstream plus
// a primed stale copy still answers instead of failing the page.
process.env.TMDB_API_KEY = 'test-key';
process.env.REDIS_URL = 'redis://127.0.0.1:6399'; // nothing listening -> cache always misses

import assert from 'node:assert/strict';

const calls = [];
let behavior = () => ({ ok: false, status: 500 });

globalThis.fetch = async (url) => {
  const { pathname } = new URL(String(url));
  const path = pathname.replace('/3', '');
  calls.push(path);
  const outcome = behavior(path, calls.filter((p) => p === path).length);
  if (outcome === 'throw') throw new Error('fetch failed');
  return outcome;
};

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const httpErr = (status) => ({ ok: false, status });

const GENRES = { genres: [{ id: 28, name: 'Action' }] };
const SEARCH_HIT = {
  page: 1,
  total_pages: 1,
  total_results: 1,
  results: [
    {
      id: 7, media_type: 'movie', title: 'T', original_title: 'T',
      release_date: '2020-01-01', overview: '', poster_path: null,
      backdrop_path: null, genre_ids: [], vote_average: 7, original_language: 'en',
    },
  ],
};

const searchCalls = () => calls.filter((p) => p === '/search/multi').length;

const tmdb = await import('../services/tmdb.js');
const { cachedIn } = await import('../config/redis.js');

/* ------------------------------------------------------- retry behavior */

// SNI flap: first attempt dies in transit, second succeeds.
calls.length = 0;
behavior = (path, n) => {
  if (path.startsWith('/genre/')) return ok(GENRES);
  if (path === '/search/multi') return n === 1 ? 'throw' : ok(SEARCH_HIT);
  return httpErr(500);
};
const flapped = await tmdb.search('flap', 1);
assert.equal(flapped.items.length, 1, 'flap recovers on retry');
assert.equal(searchCalls(), 2, 'exactly one retry for a network flap');
console.log('ok - network flap recovers on second attempt');

// Dead upstream: 500 on every attempt, then give up after MAX_ATTEMPTS.
calls.length = 0;
behavior = (path) => (path.startsWith('/genre/') ? ok(GENRES) : httpErr(500));
await assert.rejects(tmdb.search('dead', 1), /trả về 500/);
assert.equal(searchCalls(), 3, 'persistent 500 exhausts all attempts');
console.log('ok - persistent 500 throws after 3 attempts');

// Config errors must not burn retries: 401 fails fast on the first call.
calls.length = 0;
behavior = (path) => (path.startsWith('/genre/') ? ok(GENRES) : httpErr(401));
await assert.rejects(tmdb.search('badkey', 1), /trả về 401/);
assert.equal(searchCalls(), 1, '401 never retried');
console.log('ok - 401 fails fast without retry');

// 404 stays null-shaped: one call, empty result, no throw.
calls.length = 0;
behavior = (path) => (path.startsWith('/genre/') ? ok(GENRES) : httpErr(404));
const missing = await tmdb.search('nothing', 1);
assert.equal(missing.items.length, 0, '404 surfaces as empty, not a throw');
assert.equal(searchCalls(), 1, '404 never retried');
console.log('ok - 404 returns empty after a single call');

// Rate limit then success.
calls.length = 0;
behavior = (path, n) => {
  if (path.startsWith('/genre/')) return ok(GENRES);
  if (path === '/search/multi') return n === 1 ? httpErr(429) : ok(SEARCH_HIT);
  return httpErr(500);
};
const afterLimit = await tmdb.search('limited', 1);
assert.equal(afterLimit.items.length, 1, '429 recovers on retry');
assert.equal(searchCalls(), 2, '429 retried once');
console.log('ok - 429 recovers on retry');

// Timeout (AbortError) then success: same retry path as a network flap.
calls.length = 0;
behavior = (path, n) => {
  if (path.startsWith('/genre/')) return ok(GENRES);
  if (path === '/search/multi') {
    if (n === 1) throw new DOMException('The operation was aborted', 'AbortError');
    return ok(SEARCH_HIT);
  }
  return httpErr(500);
};
const afterTimeout = await tmdb.search('slow', 1);
assert.equal(afterTimeout.items.length, 1, 'timeout recovers on retry');
assert.equal(searchCalls(), 2, 'timeout retried once');
console.log('ok - timeout recovers on retry');

/* ------------------------------------------------- stale-while-revalidate */

const memStore = () => {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    set: async (k, v) => { m.set(k, v); },
    _map: m,
  };
};

const STALE = { staleOnError: true, staleTtlSeconds: 604800 };

// Loader throws + primed stale -> stale served, original error swallowed,
// and the live key backfilled so the next minute of traffic skips the loader.
{
  const store = memStore();
  await store.set('k:stale', { from: 'stale' });
  const out = await cachedIn(store, 'k', 60, async () => { throw new Error('boom'); }, STALE);
  assert.deepEqual(out, { from: 'stale' });
  assert.deepEqual(store._map.get('k'), { from: 'stale' }, 'stale backfills the live key');
  console.log('ok - loader failure serves primed stale copy');
}

// Loader throws + no stale -> original error propagates.
{
  const store = memStore();
  await assert.rejects(
    cachedIn(store, 'k', 60, async () => { throw new Error('boom-2'); }, STALE),
    /boom-2/,
  );
  console.log('ok - loader failure without stale still throws');
}

// Success writes both live and stale copies.
{
  const store = memStore();
  const out = await cachedIn(store, 'k', 60, async () => ({ fresh: true }), STALE);
  assert.deepEqual(out, { fresh: true });
  assert.deepEqual(store._map.get('k'), { fresh: true });
  assert.deepEqual(store._map.get('k:stale'), { fresh: true });
  console.log('ok - success refreshes both live and stale copies');
}

// Null loader result is a legitimate miss: returned as-is, never cached.
{
  const store = memStore();
  const out = await cachedIn(store, 'k', 60, async () => null, STALE);
  assert.equal(out, null);
  assert.equal(store._map.has('k'), false);
  assert.equal(store._map.has('k:stale'), false);
  console.log('ok - null results bypass both caches');
}

// Without opts the helper behaves exactly as before (no stale writes).
{
  const store = memStore();
  await assert.rejects(cachedIn(store, 'k', 60, async () => { throw new Error('x'); }), /x/);
  await cachedIn(store, 'k', 60, async () => ({ v: 1 }));
  assert.equal(store._map.has('k:stale'), false);
  console.log('ok - callers without stale opts see legacy behavior');
}

assert.equal(tmdb.STALE_OPTS.staleOnError, true);
assert.equal(tmdb.STALE_OPTS.staleTtlSeconds, 7 * 24 * 60 * 60);
console.log('ok - shared STALE_OPTS shape');

console.log('PASS tmdb-resilience checks');
