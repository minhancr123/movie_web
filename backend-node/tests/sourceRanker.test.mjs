/** Container preference must be a tie-breaker on egress, never a quality override. */
import assert from 'node:assert/strict';
import { parseCandidate, scoreCandidate, normalizeCapabilities } from '../services/playback/sourceRanker.js';

const CAPS = normalizeCapabilities({ hevc: true, av1: true, hdr: true, maxHeight: 2160 });
const RUNTIME = 115; // minutes, roughly Moana

const build = (filename, extra = {}) =>
  parseCandidate(
    { label: filename, filename, sizeBytes: extra.sizeBytes ?? 12e9, ...extra },
    { expectedTitles: ['Moana'], expectedYear: 2026 }
  );

const score = (candidate) => scoreCandidate(candidate, CAPS, { runtimeMinutes: RUNTIME }).score;

/* ------------------------------------------------------------------- audio */

// Release names glue the channel layout onto the codec (DDP5.1, TrueHD7.1), so
// a \b-anchored pattern misses the most common spelling there is. These are the
// forms that actually appear in the wild.
const audioOf = (name) => parseCandidate({ label: name, filename: name }).audio;
const audioCases = [
  ['Moana.2026.1080p.h264.DDP5.1.mp4', { channels: 6, eac3: true, lossless: false, browserFriendly: false }],
  ['Movie.2160p.DD5.1.mkv', { channels: 6, eac3: false, lossless: false, browserFriendly: false }],
  ['Movie.2160p.TrueHD7.1.Atmos.mkv', { channels: 8, eac3: false, lossless: true, browserFriendly: false }],
  ['Movie.1080p.DD+2.0.mkv', { channels: 2, eac3: true, lossless: false, browserFriendly: false }],
  ['Movie.2160p.DTS-HD.MA.5.1.mkv', { channels: 6, eac3: false, lossless: true, browserFriendly: false }],
  ['Movie.1080p.AAC2.0.mp4', { channels: 2, eac3: false, lossless: false, browserFriendly: true }],
  ['Movie.1080p.AAC5.1.mp4', { channels: 6, eac3: false, lossless: false, browserFriendly: false }],
  // A year must never be read as a channel layout.
  ['Movie.2015.1080p.x264.mkv', { channels: null, eac3: false, lossless: false, browserFriendly: false }],
];
for (const [name, want] of audioCases) {
  const got = audioOf(name);
  assert.deepEqual(
    {
      channels: got.channels,
      eac3: got.eac3,
      lossless: got.lossless,
      browserFriendly: got.browserFriendly,
    },
    want,
    name
  );
}
console.log('  OK  parseAudio (' + audioCases.length + ' dạng tên thật)');

/* ------------------------------------------------------------- container id */

assert.equal(build('Moana.2026.2160p.WEB.H265-NAISU.mkv').container, 'mkv');
assert.equal(build('Moana.2026.1080p.WEB.h264.aac.mp4').container, 'mp4');
assert.equal(build('Moana.2026.1080p.m4v').container, 'mp4');
assert.equal(build('Moana.2026.1080p.WEB.ts').container, 'other');
assert.equal(build('Moana 2026 1080p WEB-DL').container, null, 'không đoán bừa khi tên không nói');
console.log('  OK  nhận diện container');

/* --------------------------------------------------- direct-play tie-breaker */

const mkvAac = build('Moana.2026.1080p.WEB-DL.h264.aac.mkv');
const mp4Aac = build('Moana.2026.1080p.WEB-DL.h264.aac.mp4');
assert.ok(score(mp4Aac) > score(mkvAac), 'MP4+AAC phải hơn MKV+AAC tương đương');
assert.equal(Math.round(score(mp4Aac) - score(mkvAac)), 12, 'chênh đúng 12 điểm');
console.log('  OK  MP4+AAC > MKV tương đương  (+' + Math.round(score(mp4Aac) - score(mkvAac)) + ')');

const mp4Eac3 = build('Moana.2026.1080p.WEB-DL.h264.DDP5.1.mp4');
const mkvEac3 = build('Moana.2026.1080p.WEB-DL.h264.DDP5.1.mkv');
assert.equal(Math.round(score(mp4Eac3) - score(mkvEac3)), 2, 'MP4 mà audio phải encode lại chỉ +2');
console.log('  OK  MP4+EAC3 gần như không lợi (+' + Math.round(score(mp4Eac3) - score(mkvEac3)) + ')');

/* ----------------------------------------------- must not override quality */

const mkv2160 = build('Moana.2026.2160p.WEB-DL.h265.aac.mkv', { sizeBytes: 18e9 });
const mp41080 = build('Moana.2026.1080p.WEB-DL.h264.aac.mp4', { sizeBytes: 8e9 });
assert.ok(
  score(mkv2160) > score(mp41080),
  'MKV 2160p vẫn phải thắng MP4 1080p — bonus egress không được đổi chất lượng'
);
console.log('  OK  MKV 2160p vẫn thắng MP4 1080p');

const mp4Cam = build('Moana.2026.CAM.h264.aac.mp4');
assert.equal(scoreCandidate(mp4Cam, CAPS, { runtimeMinutes: RUNTIME }).playable, false, 'bản cam vẫn bị loại');
console.log('  OK  bonus không cứu được bản cam');

// Labels often omit frame rate. Once ffprobe proves a movie is an interpolated
// 144 fps encode, it must not be ranked as playable merely because HEVC exists.
const highFps = build('Moana.2026.1080p.WEB-DL.H.265.mkv', { probedFrameRate: 143.98 });
const highFpsVerdict = scoreCandidate(highFps, CAPS, { runtimeMinutes: RUNTIME });
assert.equal(highFpsVerdict.playable, false);
assert.match(highFpsVerdict.reasons[0], /143\.98 fps/);
console.log('  OK  ffprobe 143.98 fps bị loại khỏi nguồn phát');

console.log('\nTất cả assertion đều pass.');
