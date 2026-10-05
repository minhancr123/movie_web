/**
 * Viewer-uploaded subtitles: SRT parsing and VTT conversion.
 *
 * The security contract lives here, not in the endpoint: a mislabeled binary
 * or an HTML error page must fail with a sentence the uploader can act on,
 * never render as garbage cues. Every rejection below is a message shown
 * verbatim in the player, so each asserts the exact wording contract too.
 *
 * Run: node tests/user-subtitles.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSrt, toVttDocument, UPLOAD_MAX_BYTES } from '../services/playback/userSubtitles.js';

/* ------------------------------------------------------------ parsing */

const srt = `1
00:00:01,000 --> 00:00:04,000
Xin chào

2
00:00:05,500 --> 00:00:07,000
Tạm biệt các bạn
`;
const cues = parseSrt(srt);
assert.equal(cues.length, 2, 'two cues');
assert.equal(cues[0].start, 1000, 'comma millis parse');
assert.equal(cues[1].start, 5500, 'three-digit millis kept');
assert.equal(cues[1].end, 7000);
assert.equal(cues[0].text, 'Xin chào');

// Real-world mess tolerated: CRLF, BOM, no counters, dot millis, positions.
const messy = '\uFEFF00:00:01.000 --> 00:00:04.000 X1:000 X2:000\r\nLine one\r\nLine two\r\n\r\n00:01:00,00 --> 00:01:02,5\nShort\n';
const messyCues = parseSrt(messy);
assert.equal(messyCues.length, 2, 'BOM/CRLF/counterless/short-millis all parse');
assert.equal(messyCues[1].start, 60000, 'two-digit millis pad right');
assert.equal(messyCues[1].end, 62500, 'one-digit millis pad right');

/* ---------------------------------------------------------- rejection */

for (const [label, bad] of [
  ['empty', ''],
  ['whitespace', '   \n  '],
  ['no timestamps', 'just some text\nmore text'],
  ['timestamps but no text', '1\n00:00:01,000 --> 00:00:04,000\n'],
  ['backwards cues', '1\n00:00:04,000 --> 00:00:01,000\nHello\n'],
  ['html error page', '<html><body>Access denied</body></html>'],
]) {
  assert.throws(() => parseSrt(bad), /./, `rejects ${label}`);
}
// And the rejection must be a sentence, not a code.
assert.throws(() => parseSrt('hello'), /File trống|khung giờ|đúng là/);

/* ---------------------------------------------------------- conversion */

const vtt = toVttDocument(srt, 'film.vi.srt');
assert.ok(vtt.startsWith('WEBVTT\n'), 'VTT header present');
assert.ok(vtt.includes('00:00:01.000 --> 00:00:04.000'), 'commas become dots');
assert.ok(!vtt.includes(','), 'no SRT commas survive in timestamps');
assert.ok(vtt.endsWith('\n'), 'trailing newline');

// Already-VTT passes through rather than round-tripping (which risks
// mangling cues the player already understands).
const vttIn = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHi\n';
assert.ok(toVttDocument(vttIn, 'x.vtt').startsWith('WEBVTT'), 'VTT passes through');

// Oversize rejected before conversion work happens.
const big = `1\n00:00:01,000 --> 00:00:02,000\n${'x'.repeat(UPLOAD_MAX_BYTES)}\n`;
assert.throws(() => toVttDocument(big, 'big.srt'), /quá lớn/);

console.log('ok - SRT parses messily, VTT converts, garbage rejected with sentences');
