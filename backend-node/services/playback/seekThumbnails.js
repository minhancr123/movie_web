import { spawn } from 'node:child_process';
import { fileIdentity } from './fileSelection.js';

export const thumbnailBucket = (at, duration) => {
  if (!Number.isFinite(at) || at < 0 || !Number.isFinite(duration) || duration <= 0 || at >= duration) return null;
  return Math.floor(at);
};

/** Single-frame jobs, one at a time; bounded RAM, no growing disk cache. */
export class SeekThumbnailCache {
  constructor({ extract = extractFrame, maxBytes = 16 * 1024 * 1024, maxEntries = 512 } = {}) {
    this.extract = extract; this.maxBytes = maxBytes; this.maxEntries = maxEntries;
    this.cache = new Map(); this.bytes = 0; this.pending = new Map(); this.active = false;
  }
  async get({ infoHash, fileId, at, duration, getUrl }) {
    const bucket = thumbnailBucket(at, duration);
    if (bucket === null || !infoHash || fileId == null) return null;
    const key = `${fileIdentity(infoHash, fileId)}:${bucket}`;
    if (this.cache.has(key)) {
      const item = this.cache.get(key); this.cache.delete(key); this.cache.set(key, item); return item;
    }
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.active) return null;
    this.active = true;
    const job = (async () => {
      await Promise.resolve();
      try {
        const frame = await this.extract(await getUrl(), bucket);
        if (!Buffer.isBuffer(frame) || frame.length < 4 || frame.length > this.maxBytes) return null;
        this.cache.set(key, frame); this.bytes += frame.length;
        while (this.bytes > this.maxBytes || this.cache.size > this.maxEntries) {
          const oldest = this.cache.keys().next().value;
          this.bytes -= this.cache.get(oldest).length; this.cache.delete(oldest);
        }
        return frame;
      } catch { return null; }
      finally { this.active = false; this.pending.delete(key); }
    })();
    this.pending.set(key, job);
    return job;
  }
}

const extractFrame = (url, at) => new Promise((resolve, reject) => {
  const child = spawn(process.env.FFMPEG_BIN || 'ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1',
    '-rw_timeout', '6000000', '-ss', String(at), '-i', url,
    '-frames:v', '1', '-vf', 'scale=320:-2', '-an', '-sn', '-dn',
    '-c:v', 'mjpeg', '-threads', '1', '-q:v', '5', '-f', 'image2pipe', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const chunks = []; let bytes = 0;
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  child.stdout.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 256 * 1024) child.kill('SIGKILL'); else chunks.push(chunk);
  });
  child.once('error', () => { clearTimeout(timer); reject(new Error('Thumbnail unavailable')); });
  child.once('close', code => {
    clearTimeout(timer);
    const frame = Buffer.concat(chunks);
    if (code === 0 && frame[0] === 0xff && frame[1] === 0xd8) resolve(frame);
    else reject(new Error('Thumbnail unavailable'));
  });
});
