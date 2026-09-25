/* TEMP verification — deleted after use. */
import fs from 'fs';
import { buildFfmpegArgs, startRemuxSession, getRemuxSession, sessionPath } from './services/playback/remuxService.js';

const input = 'C:/Users/ADMIN/AppData/Local/Temp/opencode/seektest.mp4';
if (!fs.existsSync(input)) {
  console.error('missing test file, generate first');
  process.exit(2);
}
const video = { mode: 'remux', height: 1080, kbps: 8000, startAt: 180 };
const args = buildFfmpegArgs({ inputUrl: input, outputDir: '<dir>', video, encoder: { encoder: 'libx264', hardware: false } });
console.log('ffmpeg head:', args.slice(0, 12).join(' '));

const t0 = Date.now();
const session = await startRemuxSession({
  sessionId: `verify-${Date.now()}`,
  inputUrl: input,
  audioCopy: false,
  audioStreamIndex: null,
  audioChannels: 2,
  video,
});
console.log('session started, dir ready. waiting for segments...');
for (let i = 0; i < 30; i += 1) {
  await new Promise((r) => setTimeout(r, 2000));
  const dir = sessionPath(session.sessionId);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.m4s')) : [];
  const pl = fs.existsSync(`${dir}/index.m3u8`) ? fs.readFileSync(`${dir}/index.m3u8`, 'utf8') : '';
  const live = getRemuxSession(session.sessionId);
  console.log(`t+${Math.round((Date.now() - t0) / 1000)}s segs=${files.length} endlist=${pl.includes('ENDLIST')} alive=${live?.alive ?? live?.ffmpegAlive ?? '?'} firstseg=${files[0] || '-'}`);
  if (files.length >= 4) break;
}
// What does the FIRST segment actually contain? Probe its start time.
const dir = sessionPath(session.sessionId);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.m4s')).sort();
console.log('first segments:', files.slice(0, 3).join(','));
process.exit(0);
