import assert from 'node:assert/strict';
import { fetchAioStreams, aiostreamsCacheScope, aiostreamsUserDataForKey } from '../services/playback/aiostreamsClient.js';

const env = { AIOSTREAMS_BASE_URL: 'http://aiostreams:3000', AIOSTREAMS_USER_DATA: 'private-test-config' };
const media = { type: 'series', id: 'tt0903747:1:1' };
let called = false;
const rows = await fetchAioStreams(media, { env, fetchFn: async (url, options) => {
  called = true;
  assert.equal(url.hostname, 'aiostreams');
  assert.equal(url.searchParams.get('id'), media.id);
  assert.equal(options.redirect, 'error', 'credentials must not follow redirects');
  assert.equal(options.headers['x-aiostreams-user-data'], env.AIOSTREAMS_USER_DATA);
  return new Response(JSON.stringify({ success: true, data: { results: [{
    infoHash: 'a'.repeat(40), fileIdx: 2, filename: 'Show.S01E01.1080p.AVC.mkv', size: 1234,
    url: 'https://provider.example/private-account-link', requestHeaders: { authorization: 'private-account-token' },
  }] } }));
} });
assert.ok(called);
assert.equal(rows[0].behaviorHints.filename, 'Show.S01E01.1080p.AVC.mkv');
assert.equal(rows[0].behaviorHints.videoSize, 1234);
assert.equal(rows[0].fileIdx, 2);
assert.equal(rows[0].discoveryRank, 0);
assert.ok(!('url' in rows[0]) && !('requestHeaders' in rows[0]), 'shared torrent feed never shares debrid credentials');

for (const base of ['http://169.254.169.254:3000', 'http://aiostreams:3000/other', 'http://user:pass@aiostreams:3000']) {
  await assert.rejects(fetchAioStreams(media, { env: { ...env, AIOSTREAMS_BASE_URL: base }, fetchFn: () => { throw new Error('must not fetch'); } }), /endpoint configuration/);
}
await assert.rejects(fetchAioStreams({ type: 'movie', id: '../private' }, { env }), /identifier/);
await assert.rejects(fetchAioStreams(media, { env, fetchFn: async () => new Response('private upstream credentials', { status: 502 }) }), /HTTP 502/);
await assert.rejects(fetchAioStreams(media, { env, fetchFn: async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)) }), /too large/);
await assert.rejects(fetchAioStreams(media, { env, timeoutMs: 5, fetchFn: (_url, { signal }) => new Promise((_resolve, reject) => {
  signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
}) }), /aborted/);
assert.notEqual(aiostreamsCacheScope('profile-a'), aiostreamsCacheScope('profile-b'));
assert.equal(aiostreamsCacheScope('profile-a'), aiostreamsCacheScope('profile-a'));
const shared = Buffer.from(JSON.stringify({ cinevnAccountScoped: true, presets: [], services: [] })).toString('base64');
const accountA = aiostreamsUserDataForKey('private-key-a', shared);
const accountB = aiostreamsUserDataForKey('private-key-b', shared);
assert.notEqual(aiostreamsCacheScope(accountA), aiostreamsCacheScope(accountB), 'account metadata caches must be isolated');
assert.equal(JSON.parse(Buffer.from(accountA, 'base64').toString()).services[0].credentials.apiKey, 'private-key-a');
assert.ok(!Buffer.from(shared, 'base64').toString().includes('private-key-a'), 'saved profile stays credential-free');
assert.throws(() => aiostreamsUserDataForKey(null, shared), /connection is missing/);
console.log('OK AIOStreams metadata, internal peer boundary, timeout, response limit and cache isolation');

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';
process.env.REDIS_URL = 'redis://127.0.0.1:6399';
process.env.STREMIO_ADDONS = '';
process.env.STREAM_SOURCE_PROVIDER = 'aiostreams';
process.env.AIOSTREAMS_BASE_URL = env.AIOSTREAMS_BASE_URL;
process.env.AIOSTREAMS_USER_DATA = Buffer.from(JSON.stringify({ presets: [] })).toString('base64');
let attempts = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { attempts += 1; return new Response('', { status: 503 }); };
const { getStreamCandidates } = await import('../services/addonClient.js');
const { cacheClient } = await import('../config/redis.js');
try {
  const first = await getStreamCandidates({ imdbId: 'tt0133093', mediaType: 'movie' });
  assert.ok(first.errors.some((error) => error.includes('STREMIO_ADDONS')), 'failure reaches the native fallback');
  await getStreamCandidates({ imdbId: 'tt15398776', mediaType: 'movie' });
  assert.equal(attempts, 1, 'a failing provider is not retried on every movie request during cooldown');
} finally {
  globalThis.fetch = originalFetch;
  cacheClient.disconnect();
}
console.log('OK AIOStreams fallback and cooldown');
const filtering = Buffer.from(JSON.stringify({cinevnAccountScoped:true,services:[],presets:[{type:'torrentio',options:{timeout:3000}}],cinevnRequestPresets:[{type:'knaben',enabled:true,options:{timeout:8000}}],excludedStreamExpressions:[{expression:"uncached(type(streams, 'debrid'))",enabled:true},{expression:'size(streams) > 999',enabled:true}]})).toString('base64');
const foreground=JSON.parse(Buffer.from(aiostreamsUserDataForKey('key',filtering),'base64'));
const background=JSON.parse(Buffer.from(aiostreamsUserDataForKey('key',filtering,{requestDiscovery:true}),'base64'));
assert.equal(foreground.presets.length,1);assert.equal(foreground.excludedStreamExpressions.length,2);
assert.equal(background.presets.length,2);assert.equal(background.excludedStreamExpressions.length,1);
assert.equal(background.presets[0].options.timeout,8000);assert.ok(!('cinevnRequestPresets' in foreground));
assert.notEqual(aiostreamsCacheScope(JSON.stringify(background)),aiostreamsCacheScope(JSON.stringify(foreground)));
console.log('OK background uncached discovery keeps foreground filters and scope isolated');
