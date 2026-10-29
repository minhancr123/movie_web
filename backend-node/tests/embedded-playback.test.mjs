import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { catalogueEmbeds, lookupVietnameseCatalogues, isAllowedEmbeddedPlayer } from '../services/playback/vietnameseCatalogues.js';

const detail = { title: 'Quỷ Móc Mắt', englishTitle: "The Djinn's Curse 2", year: 2026, tmdbId: 1469229, imdbId: 'tt43619342' };
const movie = { name: detail.title, original_name: detail.englishTitle, year: 2026, slug: 'quy-moc-mat', tmdb: { id: 1469229 }, imdb: { id: detail.imdbId } };
const args = { type: 'movie', tmdbId: 1469229, season: null, episode: null, detail };
const url = 'https://embed18.streamc.xyz/play/example';
const groups = [{ server_name: 'Vietsub #1', items: [{ name: 'Full', slug: 'full', embed: url }] }];

test('embed discovery matches exact film, remains separate from direct media, and verifies URL', async () => {
  let validated = 0;
  const fetchJson = async u => u.includes('/search?') ? { items: [movie] } : { movie: { ...movie, episodes: groups } };
  const options = { fetchJson, validateUrl: async u => { assert.equal(u, url); validated++; return true; }, mode: 'embedded' };
  const found = await lookupVietnameseCatalogues(args, options);
  assert.equal(found.length, 1); assert.equal(validated, 1);
  assert.equal(found[0].playbackType, 'embedded'); assert.equal(found[0].directPlay, 'unknown');
  assert.match(found[0].sourceToken, /^embedded:nguonc:[a-f0-9]{24}$/);
  assert.deepEqual(await lookupVietnameseCatalogues(args, { ...options, mode: 'direct' }), []);
  assert.deepEqual(await lookupVietnameseCatalogues({ ...args, detail: { ...detail, tmdbId: 99 } }, options), []);
  assert.deepEqual(await lookupVietnameseCatalogues({ ...args, detail: { ...detail, year: 2025 } }, options), []);
  assert.deepEqual(await lookupVietnameseCatalogues(args, { ...options, validateUrl: async () => false }), []);
});

test('embed selection never invents a full film or switches season/episode', () => {
  const pack = [{ items: [{ name: '1', embed: url }, { name: '2', embed: 'javascript:alert(1)' }] }];
  assert.deepEqual(catalogueEmbeds(movie, pack, args, 'nguonc'), []);
  const show = { ...movie, type: 'series', total_episodes: 2, tmdb: { season: 2 } };
  assert.deepEqual(catalogueEmbeds(show, pack, { type: 'tv', season: 1, episode: 1 }, 'nguonc'), []);
  assert.equal(catalogueEmbeds(show, pack, { type: 'tv', season: 2, episode: 1 }, 'nguonc').length, 1);
  assert.deepEqual(catalogueEmbeds(show, pack, { type: 'tv', season: 2, episode: 2 }, 'nguonc'), []);
  for (const bad of ['http://embed18.streamc.xyz/x','https://embed18.streamc.xyz.evil.test/x','https://embed18.streamc.xyz:8443/x','https://user@embed18.streamc.xyz/x','https://127.0.0.1/x','file:///tmp/file','javascript:alert(1)']) assert.equal(isAllowedEmbeddedPlayer(bad), false, bad);
});

test('HTTP contract validates content and token scope; private no-store and safe errors', async t => {
  process.env.REDIS_CACHE_URL = 'redis://127.0.0.1:1';
  const { createEmbeddedPlaybackHandler, embeddedPickerEntry } = await import('../controllers/embeddedPlaybackController.js');
  const { cacheClient } = await import('../config/redis.js');
  t.after(() => cacheClient.disconnect());
  const source = catalogueEmbeds(movie, groups, args, 'nguonc')[0];
  assert.equal(embeddedPickerEntry(source).url, undefined, 'listing never exposes provider URL');
  let calls = 0, available = true, throwing = false;
  const handler = createEmbeddedPlaybackHandler({ loadDetail: async () => detail, loadSources: async () => {
    calls++; if (throwing) throw Error('https://secret.example/api?token=private');
    return available ? [source] : [];
  } });
  const app = express(); app.use(express.json()); app.post('/embedded', handler);
  const server = http.createServer(app); await new Promise(r => server.listen(0,'127.0.0.1',r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const post = body => fetch(`http://127.0.0.1:${server.address().port}/embedded`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  let res = await post({ type:'movie', tmdbId:1469229, embedToken:source.sourceToken });
  assert.equal(res.status,200); assert.equal(res.headers.get('cache-control'),'private, no-store');
  assert.equal((await res.json()).data.mode,'embedded');
  const before = calls;
  for (const body of [{type:'movie',tmdbId:'1469229'},{type:'tv',tmdbId:1,season:2},{type:'movie',tmdbId:1,embedToken:'https://127.0.0.1/x'}]) assert.equal((await post(body)).status,400);
  assert.equal(calls,before,'invalid inputs cannot reach upstream');
  assert.equal((await post({ type:'movie',tmdbId:1,embedToken:'embedded:nguonc:'+'f'.repeat(24) })).status,404);
  available = false; res = await post({ type:'movie',tmdbId:1469229 }); assert.equal(res.status,404);
  assert.equal((await res.json()).code,'NO_EMBEDDED_SOURCE');
  throwing = true; res = await post({ type:'movie',tmdbId:1469229 }); assert.equal(res.status,503);
  assert.ok(!(await res.text()).includes('secret.example'));
});
