/**
 * Vimo bridge matching (no network: pure title/quality helpers only).
 *
 * Vimo catalog names are bilingual Vietnamese ("Kẻ Đánh Cắp Giấc Mơ -
 * Inception"), so matching must be diacritics-insensitive, and the year
 * gate must reject same-title remakes before any string similarity.
 */
import assert from 'node:assert/strict';
import {
  normalizeTitle,
  scoreMeta,
  parseVimoQuality,
} from '../services/playback/vimoMatch.js';

/* ------------------------------------------------------- normalization */

assert.equal(normalizeTitle('Búp bê - The Doll'), 'bup be the doll');
assert.equal(normalizeTitle('Kẻ Đánh Cắp Giấc Mơ'), 'ke danh cap giac mo');
assert.equal(normalizeTitle('vimo_ke-danh-cap-giac-mo'), 'vimo ke danh cap giac mo');
assert.equal(normalizeTitle('  Full • 1080p\n'), 'full 1080p');
assert.equal(normalizeTitle(null), '');
console.log('ok - Vietnamese diacritics stripped for title comparison');

/* ------------------------------------------------------------ scoring */

const inception = { id: 'vimo_ke-danh-cap-giac-mo', name: 'Kẻ Đánh Cắp Giấc Mơ - Inception', year: 2010 };
const ctx = { titles: ['Inception', 'Inception'], year: 2010 };

assert.ok(scoreMeta(inception, ctx) >= 0.45, 'English title inside bilingual name matches');
assert.ok(
  scoreMeta(inception, { titles: ['Kẻ Đánh Cắp Giấc Mơ'], year: 2010 }) >= 0.45,
  'Vietnamese title matches diacritics-insensitively',
);
assert.equal(
  scoreMeta(inception, { titles: ['Inception'], year: 2019 }),
  0,
  'same title but wrong year is out (remake guard)',
);
assert.ok(
  scoreMeta(
    { id: 'vimo_x', name: 'Giá Trị Của Lời Nói Dối - The Invention Of Lying', year: 2009 },
    ctx,
  ) < 0.45,
  'unrelated title stays below threshold',
);
assert.equal(scoreMeta(inception, { titles: [], year: 2010 }), 0, 'no titles means no match');
assert.equal(scoreMeta({}, ctx), 0, 'empty meta never matches');
console.log('ok - year-gated bilingual title scoring');

/* ------------------------------------------------------------ quality */

assert.deepEqual(parseVimoQuality('Búp bê\nTập 02 • 1080p'), {
  resolution: 1080,
  label: 'Búp bê • Tập 02 • 1080p',
});
assert.equal(parseVimoQuality('Kẻ Đánh Cắp Giấc Mơ\nFull • 1080p').resolution, 1080);
assert.equal(parseVimoQuality('Bản đẹp').resolution, null, 'quality-less titles stay null');
console.log('ok - Vimo quality labels parsed to resolution');
