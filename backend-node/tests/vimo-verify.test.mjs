/**
 * A Vimo URL must be verified alive before it reaches the player.
 *
 * The addon lists URLs whose files are already gone — rotated hosts, purged
 * date directories, expired signatures — and the player was handed the first
 * one blind. Every dead link cost minutes of spinner plus a retry storm for
 * a film that was never going to play:
 *   GET .../hls/HezQemuq.ts -> 404, GET .../index.m3u8 -> 404, ...
 * while the server log showed a clean 200 resolve. Verify-first moves that
 * discovery to one ranged request on our side.
 *
 * Run: node tests/vimo-verify.test.mjs (local servers, no network).
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const servers = [];
const serve = (handler) => new Promise((resolve) => {
  const s = createServer(handler);
  servers.push(s);
  s.listen(0, '127.0.0.1', () => resolve(s.address().port));
});

const alivePort = await serve((_req, res) => {
  res.writeHead(206, { 'content-type': 'application/vnd.apple.mpegurl' });
  res.end('#EXTM3U\n#EXT-X-VERSION:3\n');
});
const deadPort = await serve((_req, res) => {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});
const hangingPort = await serve(() => {
  // Never responds: the verifier must give up by timeout, not hang the resolve.
});

const { verifyVimoStream } = await import(
  pathToFileURL(path.resolve(import.meta.dirname, '..', 'services', 'playback', 'vimoClient.js')).href
);

assert.equal(
  await verifyVimoStream(`http://127.0.0.1:${alivePort}/index.m3u8`),
  true,
  'a live playlist verifies',
);
assert.equal(
  await verifyVimoStream(`http://127.0.0.1:${deadPort}/index.m3u8`),
  false,
  'a 404 playlist does not',
);
assert.equal(
  await verifyVimoStream(`http://127.0.0.1:${hangingPort}/index.m3u8`),
  false,
  'a hanging host fails by timeout instead of hanging the resolve',
);
for (const bad of [null, undefined, '', 'notaurl', 'ftp://x/y']) {
  assert.equal(await verifyVimoStream(bad), false, `junk is not verified: ${String(bad)}`);
}

for (const s of servers) s.close();
console.log('ok - only live Vimo URLs reach the player');
