/**
 * Keeping the stack out of what the browser receives.
 *
 * The player's own network tab is the real audience here: dressing up the UI
 * while the JSON still says "Remux video copy, audio eac3 -> AAC-LC" and
 * "TorBox" tells anyone who looks exactly what is running. So the scrubbing
 * happens where the text is produced, not where it is displayed.
 *
 * Deny-list, not substitution: a message containing a term we do not want to
 * publish is REPLACED, never patched word by word. Patching leaves sentences
 * like "Luồng xử lý video copy, audio eac3" — still a description of the
 * pipeline, just a clumsier one — and every new term someone adds leaks until
 * a rule is written for it. Replacement fails closed.
 *
 * Run: node tests/public-vocabulary.test.mjs
 */
import assert from 'node:assert/strict';
import { hasTechnicalTerm, publicText, publicFileName } from '../services/publicVocabulary.js';

/* ------------------------------------------------------------- detection */

for (const term of [
  'TorBox', 'torbox', 'debrid', 'Stremio', 'addon', 'remux', 'Remux HLS',
  'transcode', 'ffmpeg', 'ffprobe', 'HLS', 'm3u8', 'HEVC', 'x265', 'x264',
  'H.264', 'AVC', 'WEB-DL', 'WEBRip', 'BluRay', 'NVENC', 'libx264', 'AAC-LC',
  'eac3', 'DDP5.1', 'OpenSubtitles', 'SubDL', 'infoHash', 'torrent', 'magnet',
]) {
  assert.equal(hasTechnicalTerm(`Nguồn ${term} sẵn sàng`), true, `should catch: ${term}`);
}

// Ordinary Vietnamese must survive untouched, including words that merely
// contain a term as a substring.
for (const safe of [
  'Không tìm thấy nguồn phát phù hợp',
  'Máy chủ đang bận, thử lại sau',
  'Phim đang được chuẩn bị',
  'Chất lượng 4K',
  'Đang tải phụ đề',
]) {
  assert.equal(hasTechnicalTerm(safe), false, `should pass: ${safe}`);
}
console.log('ok - technical terms detected, plain Vietnamese left alone');

/* ------------------------------------------------------------ publicText */

// Outside production nothing changes: this is the text that makes a bug
// diagnosable, and hiding it from ourselves costs more than it protects.
assert.equal(publicText('Remux video copy, audio eac3 -> AAC-LC', 'Đang phát', false),
  'Remux video copy, audio eac3 -> AAC-LC');

assert.equal(publicText('Remux video copy, audio eac3 -> AAC-LC', 'Đang phát', true), 'Đang phát');
assert.equal(publicText('Dùng lại phiên remux đang có', 'Đang phát', true), 'Đang phát');
assert.equal(publicText('Client không giải mã được HEVC', 'Không phát được', true), 'Không phát được');
// Clean text is published as written, even in production.
assert.equal(publicText('Không tìm thấy nguồn phát', 'Đang phát', true), 'Không tìm thấy nguồn phát');
assert.equal(publicText('', 'Đang phát', true), 'Đang phát', 'empty falls back');
assert.equal(publicText(null, 'Đang phát', true), 'Đang phát');
console.log('ok - only offending messages are replaced, and only in production');

/* --------------------------------------------------------- publicFileName */

// The release filename is the single biggest giveaway: codec, source, group.
assert.equal(
  publicFileName('The.End.of.Oak.Street.2026.x265.WEB-DL.2160p.HDR10Plus.mkv', true),
  '',
  'production shows no filename at all',
);
assert.equal(
  publicFileName('The.End.of.Oak.Street.2026.x265.WEB-DL.2160p.HDR10Plus.mkv', false),
  'The.End.of.Oak.Street.2026.x265.WEB-DL.2160p.HDR10Plus.mkv',
  'development keeps it — that is how a source gets identified while debugging',
);
assert.equal(publicFileName(null, true), '');
console.log('ok - the release filename never reaches a production client');
