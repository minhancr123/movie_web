/**
 * The configured TMDB base must never be the only way in.
 *
 * Production went dark for playback while the site still looked healthy: a
 * Cloudflare-fronted proxy answered 429 to every catalog read, so every
 * resolve failed, and cached rows kept the pages rendering. A proxy that
 * exists only to route around an ISP block cannot be allowed to be a
 * single point of failure.
 *
 * These assertions pin the fallback contract, with a real server standing in
 * for the dead one — no network, no credentials.
 *
 * Run: node tests/tmdb-proxy-fallback.test.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const serviceUrl = pathToFileURL(
  path.resolve(import.meta.dirname, '..', 'services', 'tmdb.js'),
).href;
const port = 18743;

// A proxy that fails the way a Cloudflare worker does: 429 on everything.
const deadProxy = createServer((_req, res) => {
  res.writeHead(429, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status_message: 'rate limited' }));
});
await new Promise((r) => deadProxy.listen(port, r));

// The real TMDB, minus the network. Shaped like a detail payload, because the
// normalizer rejects anything without a usable tmdbId — a stub returning `{}`
// would fail for the wrong reason and hide a real regression.
const realTmdb = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    id: 157336,
    title: 'Interstellar',
    original_title: 'Interstellar',
    overview: 'Explorers travel through a wormhole in space.',
    release_date: '2014-11-05',
    vote_average: 8.4,
    genres: [{ id: 878, name: 'Science Fiction' }],
  }));
});
const realPort = 18744;
await new Promise((r) => realTmdb.listen(realPort, r));

const child = spawn(process.execPath, ['--input-type=module', '-e', `
  const tmdb = await import('${serviceUrl}');
  const detail = await tmdb.getDetail('movie', 157336);
  process.stdout.write(JSON.stringify({ tmdbId: detail?.tmdbId ?? null, title: detail?.title ?? null }));
`], {
  env: {
    ...process.env,
    TMDB_BASE_URL: `http://127.0.0.1:${port}/3`,
    // The direct base is the one the fallback must land on; point it at the
    // stand-in for real TMDB so the test needs no network.
    TMDB_DIRECT_BASE_URL: `http://127.0.0.1:${realPort}/3`,
    TMDB_API_KEY: 'test-key',
    TMDB_READ_TOKEN: '',
    // No Redis here: the service imports it at module scope.
    REDIS_URL: 'redis://127.0.0.1:1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
let err = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { err += d; });
const code = await new Promise((r) => child.on('close', r));

deadProxy.close();
realTmdb.close();

assert.equal(
  code,
  0,
  `child exited ${code}\nSTDOUT: ${out.slice(0, 400)}\nSTDERR: ${err.slice(0, 1200)}`,
);
const parsed = JSON.parse(out);
assert.equal(
  parsed.tmdbId,
  157336,
  'a dead proxy must not stop the read: the fallback has to return real data, got ' + out,
);
assert.equal(parsed.title, 'Interstellar', 'and it must be the direct response, not a shell');
assert.match(
  err,
  /khong phai loi — chuyen sang/,
  'the fallback announces itself in the log, so the swap is visible',
);
console.log('ok - a dead TMDB proxy is retired and the read still succeeds');
