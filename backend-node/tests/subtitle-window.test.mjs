import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { subtitleWindowAt, subtitleSidecarName, isCompletedSubtitle } from '../services/playback/subtitleInventory.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinevn-sub-window-'));
const fake = path.join(dir, 'ffmpeg');
process.env.FFMPEG_BIN = fake;
process.env.SUBS_ROOT = dir;
const { extractSubtitleTracks } = await import('../services/playback/remuxService.js');
const out = path.join(dir, 'ready.vtt');
await fs.writeFile(fake, `#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(path.join(dir, 'args'))},JSON.stringify(args));
for(const p of args.filter(x=>x.endsWith('.vtt')))fs.writeFileSync(p,'');
setTimeout(()=>{
 if(process.env.TEST_SUB_FAIL)process.exit(1);
 for(const p of args.filter(x=>x.endsWith('.vtt')))fs.writeFileSync(p,'WEBVTT\\n\\n10:36.000 --> 10:38.920\\nHello\\n');
},300);
`, { mode: 0o700 });
test.after(async () => fs.rm(dir, { recursive: true, force: true }));

test('overlapping windows cover the requested time without scanning the whole film', () => {
  for (const at of [0, 119, 120, 648, 1339, 7000]) {
    const window = subtitleWindowAt(at);
    assert.ok(window.startAt <= at && window.startAt + window.durationSeconds > at);
    assert.equal(window.durationSeconds, 300);
    assert.ok(at - window.startAt < 120);
  }
  assert.notEqual(subtitleSidecarName('file', 0, subtitleWindowAt(0)), subtitleSidecarName('file', 0, subtitleWindowAt(648)));
});
test('empty/in-progress output is invisible; completed output preserves absolute times', async () => {
  await fs.writeFile(out, '');
  assert.equal(await isCompletedSubtitle(out), false);
  await fs.rm(out);
  const extracting = extractSubtitleTracks('fixture', [{ streamIndex: 4, outPath: out }], subtitleWindowAt(648));
  for (let i = 0; i < 100 && !(await fs.readdir(dir)).some(n => n.includes('.partial-')); i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(await isCompletedSubtitle(out), false, 'not published while ffmpeg is still writing');
  const [result] = await extracting;
  assert.equal(result.ok, true);
  assert.equal(await isCompletedSubtitle(out), true);
  assert.match(await fs.readFile(out, 'utf8'), /10:36.000 --> 10:38.920/);
  const args = JSON.parse(await fs.readFile(path.join(dir, 'args'), 'utf8'));
  assert.ok(args.includes('-copyts'));
  assert.equal(args[args.indexOf('-ss') + 1], '600');
  assert.equal(args[args.indexOf('-to') + 1], '900');
});
test('failed extraction leaves existing completed subtitles intact and removes partial files', async () => {
  const before = await fs.readFile(out, 'utf8');
  process.env.TEST_SUB_FAIL = '1';
  try { await assert.rejects(extractSubtitleTracks('fixture', [{ streamIndex: 4, outPath: out }], subtitleWindowAt(648))); }
  finally { delete process.env.TEST_SUB_FAIL; }
  assert.equal(await fs.readFile(out, 'utf8'), before);
  assert.ok(!(await fs.readdir(dir)).some(n => n.includes('.partial-')));
});

test('failed atomic replacement keeps the previous published VTT readable', async () => {
  const before = await fs.readFile(out, 'utf8');
  const rename = fs.rename;
  let intercepted = false;
  fs.rename = async (from, to) => {
    if (to === out) {
      intercepted = true;
      assert.equal(await fs.readFile(out, 'utf8'), before);
      assert.match(await fs.readFile(from, 'utf8'), /NOTE CINEVN-COVERAGE/);
      throw new Error('simulated publication failure');
    }
    return rename(from, to);
  };
  try { await assert.rejects(extractSubtitleTracks('fixture', [{ streamIndex: 4, outPath: out }], subtitleWindowAt(648))); }
  finally { fs.rename = rename; }
  assert.equal(intercepted, true);
  assert.equal(await fs.readFile(out, 'utf8'), before);
  assert.ok(!(await fs.readdir(dir)).some(n => n.includes('.partial-')));
});
