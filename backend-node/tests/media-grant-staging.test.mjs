// Local HTTP staging: real auth/controller/files; only persistence is injected.
// No production DB, provider, edge, account or secrets are contacted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import express from 'express';
import jwt from 'jsonwebtoken';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cinevn-grant-staging-'));
process.env.RENDITIONS_ROOT = root;
process.env.TRANSCODE_ROOT = path.join(root, 'sessions');
process.env.JWT_SECRET = 'local-staging-login-secret-0123456789';
process.env.MEDIA_GRANT_SECRET = 'local-staging-media-secret-0123456789';
const rid = 'c'.repeat(32), sid = 'a'.repeat(32);
const row = { sessionId: sid, publishedRenditionId: rid, userIdStr: 'staging-owner', expiresAt: new Date(Date.now() + 3600000) };
// Exercise production ownership/expiry logic, with a deliberately isolated store.
globalThis.cinevnGrantStagingDB = { collection: () => ({
  findOne: async q => q.sessionId === sid ? row : null,
  find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [row] }) }) }),
  updateOne: async () => ({ modifiedCount: 1 }),
}) };
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith('/config/database.js')) return { url: 'data:text/javascript,export const getDB=()=>globalThis.cinevnGrantStagingDB;export default null;', shortCircuit: true };
  return next(specifier, context);
} });
let server, edge;
try {
  const { mediaAuthMiddleware } = await import('../middleware/auth.js');
  const { serveRenditionAsset } = await import('../controllers/playbackController.js');
  const { mintMediaGrant } = await import('../services/playback/mediaGrant.js');
  const dir = path.join(root, rid); await fs.mkdir(dir);
  const media = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=64x64:r=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-threads', '1', '-g', '24',
    '-c:a', 'aac', '-f', 'hls', '-hls_time', '1', '-hls_segment_type', 'fmp4', '-hls_list_size', '0',
    '-hls_segment_filename', path.join(dir, 'seg_%05d.m4s'), path.join(dir, 'index.m3u8')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(media.status, 0, media.stderr); // Mandatory: never skip missing media tools.
  const app = express(); app.get('/api/playback/hls/r/:renditionId/:asset', mediaAuthMiddleware, serveRenditionAsset);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const route = `/api/playback/hls/r/${rid}/`;
  const login = jwt.sign({ userId: 'staging-owner' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const headers = { Authorization: `Bearer ${login}` };
  const checks = [];
  const check = async (name, fn) => { await fn(); checks.push(name); console.log(`ok - staging ${name}`); };
  let child, manifestBody;
  await check('legacy-native-manifest-and-scoped-child-URLs', async () => {
    const r = await fetch(`${base}${route}index.m3u8?access_token=${login}`); assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control'), /private.*no-store/); manifestBody = await r.text();
    const urls = [...manifestBody.matchAll(/URI="([^"]+)"/g)].map(m => m[1]);
    urls.push(...manifestBody.split('\n').filter(l => l && !l.startsWith('#')));
    assert(urls.length >= 4); assert(!manifestBody.includes(login), 'no account JWT in child URLs');
    for (const url of urls) { assert(new URL(url, `${base}${route}`).searchParams.has('media_grant')); assert.equal((await fetch(new URL(url, `${base}${route}`))).status, 200); }
    child = new URL(urls.find(u => u.includes('.m4s')), `${base}${route}`);
  });
  await check('native-HEAD-and-Range-206-use-real-fragment-bytes', async () => {
    const head = await fetch(child, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
    const r = await fetch(child, { headers: { Range: 'bytes=0-31' } }); assert.equal(r.status, 206); assert.match(r.headers.get('content-range'), /^bytes 0-31\//);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), (await fs.readFile(path.join(dir, path.basename(child.pathname)))).subarray(0, 32));
    assert.match(r.headers.get('cache-control'), /private/); assert(!r.headers.get('cache-control').includes('public'));
  });
  await check('bare-old-child-fails-closed-MSE-Bearer-still-works', async () => {
    const bare = `${base}${child.pathname}`; assert.equal((await fetch(bare)).status, 401);
    assert.equal((await fetch(bare, { headers })).status, 200);
    assert.equal((await fetch(bare, { headers: { Authorization: `Bearer ${jwt.sign({ userId: 'other-viewer' }, process.env.JWT_SECRET)}` } })).status, 403);
  });
  const expired = mintMediaGrant({ sessionId: sid, renditionId: rid, nowMs: Date.now() - 10000, ttlMs: 1000 }).token;
  await check('expired-grant-and-Bearer-manifest-refresh', async () => {
    const url = `${base}${route}index.m3u8?media_grant=${expired}`;
    assert.equal((await fetch(url)).status, 401);
    const refreshed = await fetch(url, { headers }); assert.equal(refreshed.status, 200);
    const body = await refreshed.text(); assert(!body.includes(expired));
    const urlChild = body.split('\n').find(l => l && !l.startsWith('#'));
    assert.equal((await fetch(new URL(urlChild, `${base}${route}`))).status, 200);
  });
  await check('old-rid-only-grant-requires-refresh', async () => {
    const old = mintMediaGrant({ renditionId: rid }).token;
    const r = await fetch(`${base}${route}index.m3u8?media_grant=${old}`); assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'GRANT_REFRESH_REQUIRED');
  });
  await check('wrong-scope-and-expired-session', async () => {
    assert.equal((await fetch(new URL(child.href.replace(rid, 'd'.repeat(32))))).status, 403);
    const previous = row.expiresAt; row.expiresAt = new Date(Date.now() - 1000);
    assert.equal((await fetch(child)).status, 410); row.expiresAt = previous;
  });
  // A standards-respecting shared cache must never reuse these private responses.
  // This does NOT validate a real deployed CDN override or purge old public objects.
  const cache = new Map();
  edge = http.createServer(async (req, res) => {
    try {
      const key = new URL(req.url, base).pathname;
      let cached = cache.get(key);
      if (!cached) {
        const r = await fetch(new URL(req.url, base), { headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {} });
        cached = { status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) };
        if (/\bpublic\b/.test(r.headers.get('cache-control') || '') && !/no-store|private/.test(r.headers.get('cache-control') || '')) cache.set(key, cached);
      }
      res.writeHead(cached.status, cached.headers); res.end(cached.body);
    } catch { res.writeHead(502); res.end(); }
  }).listen(0, '127.0.0.1'); await new Promise(resolve => edge.once('listening', resolve));
  await check('shared-cache-cannot-replay-authorized-bytes-to-bare-client', async () => {
    const proxy = `http://127.0.0.1:${edge.address().port}`;
    assert.equal((await fetch(`${proxy}${child.pathname}${child.search}`)).status, 200);
    assert.equal((await fetch(`${proxy}${child.pathname}`)).status, 401); assert.equal(cache.size, 0);
  });
  console.log(JSON.stringify({ staging: 'local-HTTP-real-controller', checks: checks.length, externalCDN: 'not-tested', oldPublicCachePurge: 'required-before-release' }));
} finally {
  await Promise.all([server, edge].filter(Boolean).map(s => new Promise(resolve => s.close(resolve))));
  const { cacheClient } = await import('../config/redis.js');
  cacheClient.disconnect();
  hook.deregister(); delete globalThis.cinevnGrantStagingDB; await fs.rm(root, { recursive: true, force: true });
}
