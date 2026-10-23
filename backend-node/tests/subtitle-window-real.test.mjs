import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractSubtitleTracks } from '../services/playback/remuxService.js';

if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
  console.log('skip - real subtitle window needs ffmpeg');
  process.exit(0);
}
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinevn-sub-window-real-'));
try {
  const srt = path.join(dir, 'source.srt');
  const input = path.join(dir, 'source.mkv');
  await fs.writeFile(srt, '1\n00:00:02,000 --> 00:00:04,000\nBefore\n\n2\n00:00:14,000 --> 00:00:16,000\nInside\n\n3\n00:00:24,000 --> 00:00:26,000\nAfter\n');
  const fixture = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=32x32:rate=1',
    '-i', srt, '-t', '30', '-map', '0:v:0', '-map', '1:s:0', '-c:v', 'libx264',
    '-preset', 'ultrafast', '-c:s', 'srt', '-y', input], { encoding: 'utf8', timeout: 15000 });
  assert.equal(fixture.status, 0, fixture.stderr);
  const outPath = path.join(dir, 'window.vtt');
  const [result] = await extractSubtitleTracks(input, [{ streamIndex: 1, outPath }], { startAt: 12, durationSeconds: 8 });
  assert.equal(result.ok, true);
  const text = await fs.readFile(outPath, 'utf8');
  assert.match(text, /00:14.000 --> 00:16.000/);
  assert.match(text, /Inside/);
  assert.doesNotMatch(text, /Before|After/);
  console.log('ok - real MKV extraction preserves absolute subtitle time within the requested window');
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
