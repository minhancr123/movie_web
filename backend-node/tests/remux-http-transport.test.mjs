import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildFfmpegArgs, httpInputReuseArgs } from '../services/playback/remuxService.js';

test('HTTP reuse is opt-in, bounded and absent from local/encoded inputs', () => {
  assert.deepEqual(httpInputReuseArgs('https://cdn.example/movie.mkv'), []);
  assert.deepEqual(httpInputReuseArgs('https://cdn.example/movie.mkv', true),
    ['-multiple_requests', '1', '-short_seek_size', '1048576']);
  for (const url of ['/tmp/file.mkv', 'file:///tmp/file.mkv', 'pipe:0', 'rtsp://example/stream']) {
    assert.deepEqual(httpInputReuseArgs(url, true), []);
  }
  const common = { inputUrl: 'https://cdn.example/movie.mkv', outputDir: '/tmp/out', readRate: 2,
    initialBurstSeconds: 8, video: { mode: 'copy', codec: 'h264', startAt: 197 } };
  const before = buildFfmpegArgs({ ...common, httpKeepAlive: false });
  const after = buildFfmpegArgs({ ...common, httpKeepAlive: true });
  const start = after.indexOf('-multiple_requests');
  assert(start >= 0 && start < after.indexOf('-i'));
  assert.deepEqual([...after.slice(0, start), ...after.slice(start + 4)], before,
    'all seek, rate, codec, audio, timestamp and mux arguments stay identical');
  const encoded = buildFfmpegArgs({ ...common, video: { mode: 'transcode', codec: 'h264' }, httpKeepAlive: true });
  assert(!encoded.includes('-multiple_requests'));
});

const run = (bin, args) => new Promise((resolve, reject) => {
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('media fixture timeout')); }, 30000);
  child.stdout.on('data', b => { stdout += b; });
  child.stderr.on('data', b => { stderr += b; });
  child.once('error', e => { clearTimeout(timer); reject(e); });
  child.once('close', code => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr)); });
});

test('ranged HTTP reuse preserves H.264/Main10 packets, audio and decoded frames, including MP4/HLS and Connection: close', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cinevn-http-media-'));
  let server;
  try {
    const sources = {};
    for (const kind of ['h264', 'hevc', 'mp4']) {
      const codec = kind === 'hevc' ? 'hevc' : 'h264';
      const file = path.join(root, kind === 'mp4' ? 'source.mp4' : `${kind}.mkv`);
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=24000/1001',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '12', '-threads', '1',
        '-c:v', codec === 'hevc' ? 'libx265' : 'libx264',
        ...(codec === 'hevc' ? ['-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error:pools=1:frame-threads=1:bframes=0:keyint=48:min-keyint=48:scenecut=0']
          : ['-g', '48', '-sc_threshold', '0']), '-c:a', 'aac', '-y', file]);
      sources[kind] = await fs.readFile(file);
    }
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path.join(root, 'source.mp4'),
      '-c', 'copy', '-f', 'hls', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4', '-hls_time', '4',
      '-hls_fmp4_init_filename', 'source-init.mp4', '-hls_segment_filename', path.join(root, 'source-%d.m4s'),
      path.join(root, 'source.m3u8')]);
    for (const file of await fs.readdir(root)) {
      if (file.startsWith('source-')) sources[file] = await fs.readFile(path.join(root, file));
    }
    sources.hls = await fs.readFile(path.join(root, 'source.m3u8'));
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const data = sources[url.pathname.slice(1)];
      if (!data) { res.writeHead(404).end(); return; }
      if (url.searchParams.has('close')) res.setHeader('Connection', 'close');
      res.setHeader('Accept-Ranges', 'bytes');
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0;
      if (start >= data.length) { res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }).end(); return; }
      const end = range?.[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      const type = url.pathname === '/hls' ? 'application/vnd.apple.mpegurl' : url.pathname === '/mp4' ? 'video/mp4' : 'application/octet-stream';
      const headers = { 'Content-Type': type, 'Content-Length': end - start + 1 };
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${data.length}`;
      res.writeHead(range ? 206 : 200, headers); res.end(data.subarray(start, end + 1));
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    for (const kind of ['h264', 'hevc', 'mp4', 'hls']) {
      const codec = kind === 'hevc' ? 'hevc' : 'h264';
      let baselinePackets, baselineFrames;
      for (const [name, enabled, close] of [['baseline', false, false], ['reuse', true, false], ['server-closes', true, true]]) {
        const dir = path.join(root, `${kind}-${name}`); await fs.mkdir(dir);
        const inputUrl = `http://127.0.0.1:${server.address().port}/${kind}${close ? '?close=1' : ''}`;
        await run('ffmpeg', buildFfmpegArgs({ inputUrl, outputDir: dir, readRate: 0, httpKeepAlive: enabled,
          audioCopy: codec === 'hevc', windowSeconds: 6, video: { mode: 'copy', codec, hasBFrames: codec === 'hevc' ? 0 : 2, startAt: 5 } }));
        const playlist = path.join(dir, 'index.m3u8');
        if (codec === 'hevc') {
          const info = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=codec_name,profile,pix_fmt', '-of', 'json', playlist]);
          const v = JSON.parse(info.stdout).streams[0];
          assert.equal(v.codec_name, 'hevc'); assert.equal(v.profile, 'Main 10');
          assert.equal(v.pix_fmt, 'yuv420p10le', 'Main10 is preserved without silently downconverting');
        }
        const p = await run('ffprobe', ['-v', 'error', '-show_packets', '-show_data_hash', 'sha256',
          '-show_entries', 'packet=codec_type,pts_time,dts_time,duration_time,data_hash', '-of', 'json', playlist]);
        const packets = JSON.parse(p.stdout).packets;
        assert(packets.some(p => p.codec_type === 'audio') && packets.some(p => p.codec_type === 'video'));
        const frames = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', playlist, '-map', '0:v:0', '-f', 'framemd5', '-']);
        assert.equal(frames.stderr.trim(), '', 'no concealed decoder errors');
        if (name === 'baseline') { baselinePackets = packets; baselineFrames = frames.stdout; }
        else {
          assert.deepEqual(packets, baselinePackets, `${kind}/${name}: identical packet PTS/DTS/duration/payload, including audio`);
          assert.equal(frames.stdout, baselineFrames, `${kind}/${name}: identical decoded frames`);
        }
      }
    }
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await fs.rm(root, { recursive: true, force: true });
  }
});
