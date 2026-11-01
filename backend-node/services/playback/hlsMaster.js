/** Describe the output init segment, never the source file or a guessed codec. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const probes = new Map();

export const decodeProbeData = (text = '') => Buffer.from(text.split('\n')
  .filter(line => /^[0-9a-f]{8}: /i.test(line))
  .map(line => line.slice(10).trim().split(/\s{2,}/)[0].replace(/\s/g, '')).join(''), 'hex');

export const outputCodec = (stream) => {
  const data = decodeProbeData(stream.extradata);
  const tag = stream.codec_tag_string;
  if (stream.codec_name === 'h264' && data.length >= 4 && data[0] === 1 && ['avc1', 'avc3'].includes(tag)) {
    return `${tag}.${data.subarray(1, 4).toString('hex')}`;
  }
  if (stream.codec_name === 'hevc' && data.length >= 23 && data[0] === 1 && ['hvc1', 'hev1'].includes(tag)) {
    const space = ['', 'A', 'B', 'C'][data[1] >> 6];
    let compatibility = 0;
    const raw = data.readUInt32BE(2);
    for (let i = 0; i < 32; i++) compatibility = compatibility * 2 + ((raw >>> i) & 1);
    const constraints = Array.from(data.subarray(6, 12));
    while (constraints.length && constraints.at(-1) === 0) constraints.pop();
    return `${tag}.${space}${data[1] & 31}.${compatibility.toString(16).toUpperCase()}.${data[1] & 32 ? 'H' : 'L'}${data[12]}`
      + constraints.map(byte => `.${byte.toString(16).toUpperCase()}`).join('');
  }
  if (stream.codec_name === 'aac' && tag === 'mp4a' && data.length >= 2) {
    let objectType = data[0] >> 3;
    if (objectType === 31) objectType = 32 + ((data[0] & 7) << 3) + (data[1] >> 5);
    return `mp4a.40.${objectType}`;
  }
  if (stream.codec_name === 'h264') {
    for (let i = 0; i + 6 < data.length; i++) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && (data[i + 3] & 31) === 7) {
        return `avc1.${data.subarray(i + 4, i + 7).toString('hex')}`;
      }
    }
  }
  // ADTS carries its audio configuration in each frame rather than avcC/esds.
  if (stream.codec_name === 'aac' && stream.profile === 'LC' && tag === '[15][0][0][0]') return 'mp4a.40.2';
  throw new Error('Unsupported output sample description');
};

const describeOutput = async (initPath) => {
  const stat = await fs.stat(initPath);
  const key = `${initPath}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  if (probes.has(key)) return probes.get(key);
  const pending = (async () => {
    const { stdout } = await run(process.env.FFPROBE_BIN || 'ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_name,codec_type,codec_tag_string,width,height,color_transfer,profile,extradata',
      '-show_data', '-of', 'json', initPath,
    ], { timeout: 5000, maxBuffer: 1024 * 1024 });
    const streams = JSON.parse(stdout).streams || [];
    const video = streams.find(stream => stream.codec_type === 'video');
    if (!video || !(video.width > 0 && video.height > 0)) throw new Error('Missing output video metadata');
    const media = streams.filter(stream => ['video', 'audio'].includes(stream.codec_type));
    return { width: video.width, height: video.height, codecs: media.map(outputCodec).join(','),
      range: { smpte2084: 'PQ', 'arib-std-b67': 'HLG', bt709: 'SDR' }[video.color_transfer] };
  })();
  probes.set(key, pending);
  while (probes.size > 128) probes.delete(probes.keys().next().value);
  try { return await pending; } catch (error) { probes.delete(key); throw error; }
};

// A weighted average of any segment window cannot exceed the maximum individual
// segment rate. This conservative BANDWIDTH is measured from actual muxed bytes.
const peakBandwidth = async (playlistPath) => {
  const text = await fs.readFile(playlistPath, 'utf8');
  const entries = [...text.matchAll(/#EXTINF:([\d.]+)[^\n]*\n(seg_\d+\.(?:m4s|ts))\s*(?:\n|$)/g)];
  if (!entries.length) throw Object.assign(new Error('Segments not ready'), { code: 'ENOENT' });
  let peak = 0;
  for (let i = 0; i < entries.length; i += 16) {
    const rates = await Promise.all(entries.slice(i, i + 16).map(async ([, duration, name]) => {
      const seconds = Number(duration);
      if (!(seconds > 0)) throw new Error('Invalid segment duration');
      const { size } = await fs.stat(path.join(path.dirname(playlistPath), name));
      return size * 8 / seconds;
    }));
    peak = Math.max(peak, ...rates);
  }
  return Math.max(1, Math.ceil(peak));
};

export const buildMasterPlaylist = async ({ playlistPath, indexUrl }) => {
  if (/[\r\n]/.test(indexUrl)) throw new Error('Invalid child playlist URL');
  const playlist = await fs.readFile(playlistPath, 'utf8');
  const firstTs = /^seg_\d+\.ts$/m.exec(playlist)?.[0];
  const descriptionPath = path.join(path.dirname(playlistPath), firstTs && !playlist.includes('#EXT-X-MAP:') ? firstTs : 'init.mp4');
  const [output, bandwidth] = await Promise.all([
    describeOutput(descriptionPath),
    peakBandwidth(playlistPath),
  ]);
  return ['#EXTM3U', '#EXT-X-VERSION:7',
    `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${output.width}x${output.height},CODECS="${output.codecs}"${output.range ? `,VIDEO-RANGE=${output.range}` : ''}`,
    indexUrl, ''].join('\n');
};
