/** Isolated, bounded copy-video benchmark. Input URL comes from the environment,
 * never argv/output. No production session, DB or provider account is modified.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { buildFfmpegArgs, ffprobe } from '../services/playback/remuxService.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exec = (bin, args, cleanErrors = false) => new Promise((resolve, reject) => {
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('benchmark subprocess timeout')); }, 15000);
  child.stdout.on('data', b => { stdout += b; });
  child.stderr.on('data', b => { stderr = (stderr + b).slice(-16384); });
  child.once('error', () => { clearTimeout(timer); reject(new Error('benchmark subprocess unavailable')); });
  child.once('close', code => { clearTimeout(timer); code === 0 && (!cleanErrors || !stderr.trim()) ? resolve(stdout) : reject(new Error('benchmark subprocess failed')); });
});

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Set SEEK_BENCH_INPUT, SEEK_BENCH_START, SEEK_BENCH_ORIGIN and SEEK_BENCH_TARGET privately. Optional SEEK_BENCH_AUDIO_INDEX (default 0). Four isolated runs; no URL/credentials printed.');
    return;
  }
  const input = process.env.SEEK_BENCH_INPUT;
  const startAt = Number(process.env.SEEK_BENCH_START), origin = Number(process.env.SEEK_BENCH_ORIGIN);
  const target = Number(process.env.SEEK_BENCH_TARGET), audioIndex = Number(process.env.SEEK_BENCH_AUDIO_INDEX || 0);
  const local = target - origin;
  if (!input || ![startAt, origin, target].every(Number.isFinite) || startAt < 0 || startAt > target
      || origin < 0 || origin > startAt || local < 0 || local > 30 || !Number.isInteger(audioIndex) || audioIndex < 0) {
    throw new Error('invalid benchmark configuration');
  }
  const probe = await ffprobe(input), audio = probe.audio?.[audioIndex];
  if (!audio || !['h264', 'hevc'].includes(probe.video?.codec)) throw new Error('unsupported benchmark fixture');
  const version = (await exec(process.env.FFMPEG_BIN || 'ffmpeg', ['-version'])).split('\n')[0];
  const fixture = crypto.createHash('sha256').update(input.split('?')[0]).digest('hex').slice(0, 12);
  console.log(JSON.stringify({ fixture, version, codec: probe.video.codec, height: probe.video.height,
    startAt, origin, target, productionUnchanged: true }));
  const results = [];
  for (const enabled of [false, true, true, false]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinevn-transport-bench-'));
    let child, closed, debug = '', maxObservedRssMiB = null;
    try {
      const args = buildFfmpegArgs({ inputUrl: input, outputDir: dir, readRate: 2, initialBurstSeconds: 8,
        httpKeepAlive: enabled, audioCopy: false, audioStreamIndex: audio.streamIndex, audioChannels: audio.channels,
        windowSeconds: Math.ceil(local + 12), video: { mode: 'copy', codec: probe.video.codec,
          hasBFrames: probe.video.hasBFrames, startAt } });
      args[args.indexOf('-loglevel') + 1] = 'debug'; // Count connections in memory; never persist the private log.
      const started = performance.now();
      child = spawn(process.env.FFMPEG_BIN || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      closed = new Promise(resolve => { child.once('close', resolve); child.once('error', () => resolve(-1)); });
      child.stderr.on('data', b => { debug = (debug + b).slice(-2 * 1024 * 1024); });
      const phases = {}; let duration = 0;
      while (performance.now() - started < 25000) {
        const elapsed = Math.round(performance.now() - started);
        try { if ((await fs.stat(path.join(dir, 'init.mp4'))).size) phases.initMs ??= elapsed; } catch {}
        try {
          const body = await fs.readFile(path.join(dir, 'index.m3u8'), 'utf8');
          duration = [...body.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
          if (duration > 0) phases.firstSegmentMs ??= elapsed;
          if (duration >= local + 4) { phases.targetRunwayMs = elapsed; break; }
        } catch {}
        try {
          const status = await fs.readFile(`/proc/${child.pid}/status`, 'utf8');
          const rss = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1]);
          if (rss > 0) maxObservedRssMiB = Math.max(maxObservedRssMiB || 0, rss / 1024);
        } catch {} // Unavailable on macOS: leave absent, never invent a sample.
        if (child.exitCode !== null || child.signalCode !== null) break;
        await sleep(25);
      }
      child.kill('SIGTERM');
      if (await Promise.race([closed.then(() => true), sleep(3000).then(() => false)]) !== true) child.kill('SIGKILL');
      await closed;
      if (phases.targetRunwayMs === undefined) throw new Error('target runway unavailable');
      const frames = await exec(process.env.FFMPEG_BIN || 'ffmpeg', ['-hide_banner', '-loglevel', 'error',
        '-ss', String(local), '-i', path.join(dir, 'index.m3u8'), '-map', '0:v:0', '-frames:v', '1', '-f', 'framemd5', '-'], true);
      const hash = frames.split('\n').find(l => l && !l.startsWith('#'))?.split(',').at(-1)?.trim();
      if (!hash) throw new Error('target frame unavailable');
      const row = { fixture, reuseHttp: enabled, ...phases, headSeconds: duration, targetFrameHash: hash,
        httpRequests: (debug.match(/request: GET /g) || []).length,
        connectionAttempts: (debug.match(/Starting connection attempt/g) || []).length,
        maxObservedRssMiB: maxObservedRssMiB === null ? null : Math.round(maxObservedRssMiB) };
      results.push(row); console.log(JSON.stringify(row));
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
  const sameTargetFrame = results.length === 4 && new Set(results.map(r => r.targetFrameHash)).size === 1;
  console.log(JSON.stringify({ sameTargetFrame, runs: results.length }));
  if (!sameTargetFrame) throw new Error('different decoded destination frames');
}

main().catch(() => { console.error(JSON.stringify({ failed: true, reason: 'benchmark did not validate; private input/error text withheld' })); process.exitCode = 1; });
