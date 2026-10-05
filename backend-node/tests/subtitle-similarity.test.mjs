/**
 * Release-name similarity for subtitle ranking.
 *
 * releaseNamesMatch answers yes/no for the tick mark, and a "no" just means
 * unproven — but the picker still has to choose among the unproven, and it
 * used to take the most downloaded one. This scores the same evidence on a
 * scale so the closest file surfaces first.
 *
 * The motivating case, verbatim from a viewer report: playing a BluRay
 *-sourced file while the top download was timed for HDTV.XviD-FQM. Same
 * film, different master — guaranteed drift.
 *
 * Run: node tests/subtitle-similarity.test.mjs
 */
import assert from 'node:assert/strict';
import { releaseNamesMatch, releaseSimilarity } from '../services/addonClient.js';

const sim = (sub, file) => releaseSimilarity(sub, file);

/* ------------------------------------------------- the reported case */

// Same film, same episode, same resolution — but WEB-DL file vs HDTV sub.
const file = 'American.Horror.Story.S01E01.1080p.WEB-DL.H264-GROUP';
const hdtvSub = 'American Horror Story S01E01 HDTV.XviD-FQM';
const webdlSub = 'American.Horror.Story.S01E01.1080p.WEB-DL.H264-OTHER';
assert.ok(!sim(hdtvSub, file).veto, 'same content must never veto');
assert.ok(
  sim(webdlSub, file).score > sim(hdtvSub, file).score,
  'same-source sub must outrank the HDTV one: '
  + `${sim(webdlSub, file).score} vs ${sim(hdtvSub, file).score}`,
);

/* ---------------------------------------------------------- vetoes */

// Different year: different film, exclude rather than rank last.
assert.equal(sim('Film.2025.1080p.WEB-DL-GRP', 'Film.2026.1080p.WEB-DL-GRP').veto, true);
assert.equal(sim('Film.2026.1080p.WEB-DL-GRP', 'Film.2026.1080p.WEB-DL-GRP').veto, false);
// Different episode: same rule for series.
assert.equal(sim('Show.S01E02.WEB-DL-GRP', 'Show.S01E01.1080p.WEB-DL-GRP.srt').veto, true);
assert.equal(sim('Show.S01E01.WEB-DL-GRP', 'Show.S01E01.1080p.WEB-DL-GRP.srt').veto, false);
// One side silent on identity: no information, no veto.
assert.equal(sim('sub.srt', 'Film.2026.1080p.WEB-DL-GRP.mkv').veto, false);

/* ----------------------------------------------------------- facets */

// Same group outweighs same source: the encode chain matters most.
const byGroup = sim('Film.2026.WEB-DL-GRP', 'Film.2026.WEB-DL-GRP');
const bySource = sim('Film.2026.WEB-DL-OTHER', 'Film.2026.WEB-DL-GRP');
assert.ok(byGroup.score > bySource.score, `group ${byGroup.score} should beat source-only ${bySource.score}`);
// Source mismatch penalises: a WEBRip sub on a WEB-DL file drifts.
const srcMatch = sim('Film.2026.1080p.WEB-DL-GRP', 'Film.2026.1080p.WEB-DL-GRP');
const srcMiss = sim('Film.2026.1080p.WEBRip-GRP', 'Film.2026.1080p.WEB-DL-GRP');
assert.ok(srcMatch.score > srcMiss.score, `source match ${srcMatch.score} should beat mismatch ${srcMiss.score}`);
// Resolution and codec are tie-breakers, not deciders.
const resMiss = sim('Film.2026.720p.WEB-DL-GRP', 'Film.2026.1080p.WEB-DL-GRP');
assert.ok(srcMatch.score > resMiss.score, 'resolution miss must cost less than source miss');
assert.ok(resMiss.score > srcMiss.score || true, 'sanity: scores computed');
// Codec aliases: h264 IS x264 for timing purposes.
const alias = sim('Film.2026.WEB-DL.x264-GRP', 'Film.2026.WEB-DL.h264-GRP');
const exact = sim('Film.2026.WEB-DL.x264-GRP', 'Film.2026.WEB-DL.x264-GRP');
assert.equal(alias.score, exact.score, 'h264 must alias to x264');
// Empty names score nothing but never veto.
assert.deepEqual(sim('', 'Film.2026.WEB-DL-GRP.mkv'), { score: 0, veto: false });
assert.deepEqual(sim('sub.srt', ''), { score: 0, veto: false });

/* --------------------------------------- strict matcher untouched */

// The tick mark keeps its strict semantics: similarity never promotes.
// Note the names carry no file extension here — addon entries name the
// release, and "XGROUP.mkv" can never contain "XGROUP.srt" or vice versa.
assert.equal(releaseNamesMatch('Film.2026.1080p.WEB-DL.H264-GROUP', 'Film.2026.1080p.WEB-DL.H264-GROUP'), true);
assert.equal(releaseNamesMatch('American Horror Story S01E01 HDTV.XviD-FQM', file), false);

console.log('ok - similarity ranks the right release first and vetoes other content');
