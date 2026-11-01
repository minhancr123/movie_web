import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { ffprobe } from '../services/playback/remuxService.js';

test('remote probe reads a tail-moov MP4 through HTTP ranges without concatenating file offsets', async () => {
  assert.equal(spawnSync('ffmpeg', ['-version']).status, 0, 'requires ffmpeg');
  const dir = await mkdtemp(path.join(tmpdir(), 'cinevn-http-probe-'));
  let server;
  try {
    const source = path.join(dir, 'short.mp4');
    const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1',
      '-c:v', 'libx264', '-c:a', 'aac', '-y', source]);
    assert.equal(made.status, 0, made.stderr.toString());
    const original = await readFile(source);
    let moov = -1;
    for (let offset = 0; offset + 8 <= original.length;) {
      const size = original.readUInt32BE(offset);
      if (original.toString('ascii', offset + 4, offset + 8) === 'moov') { moov = offset; break; }
      assert(size >= 8); offset += size;
    }
    assert(moov > 0);
    // A legal free box puts the metadata far away while keeping sample offsets
    // intact, without generating a large movie for this regression fixture.
    const free = Buffer.alloc(12 * 1024 * 1024);
    free.writeUInt32BE(free.length); free.write('free', 4);
    const file = path.join(dir, 'tail.mp4');
    await writeFile(file, Buffer.concat([original.subarray(0, moov), free, original.subarray(moov)]));
    const size = (await stat(file)).size, starts = [];
    server = createServer((req, res) => {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      starts.push(start);
      res.writeHead(match ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1, ...(match ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
      const stream = createReadStream(file, { start, end });
      res.on('close', () => stream.destroy()); stream.pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const result = await ffprobe(`http://127.0.0.1:${server.address().port}/tail.mp4`);
    assert.equal(result.video.codec, 'h264'); assert.equal(result.video.height, 90);
    assert.equal(result.audio[0].codec, 'aac');
    assert(Math.abs(result.duration - 1) < 0.1);
    assert(starts.some(start => start > 8 * 1024 * 1024), 'ffprobe seeks to distant metadata itself');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await rm(dir, { recursive: true, force: true });
  }
});
