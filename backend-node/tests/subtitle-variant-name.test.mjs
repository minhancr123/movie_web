/**
 * Keeping the release name on an online subtitle variant.
 *
 * An addon usually says WHICH release a sidecar was timed for
 * ("1080p.WEBRip.x264-RARBG", "[HI] WEBDL.2160p"). normalizeSubtitlePayload
 * used to drop that, so three Vietnamese sidecars for three different releases
 * arrived as "Tiếng Việt 1", "Tiếng Việt 2", "Tiếng Việt 3" — indistinguishable.
 * The viewer picks one, finds it a second out, and has no way to tell that
 * another entry in the same list matches their file exactly.
 *
 * Run: node tests/subtitle-variant-name.test.mjs
 */
import assert from 'node:assert/strict';
import { normalizeSubtitlePayload, releaseNamesMatch, subtitleVariantLabel } from '../services/addonClient.js';

const one = (extra) => normalizeSubtitlePayload(
  { subtitles: [{ url: 'https://example.test/a.srt', lang: 'vie', ...extra }] },
  'subdl',
)[0];

/* --------------------------------------------------------- name capture */

assert.equal(one({ name: '1080p.WEBRip.x264-RARBG' }).name, '1080p.WEBRip.x264-RARBG');
assert.equal(one({ title: 'WEBDL.2160p.HDR' }).name, 'WEBDL.2160p.HDR', 'title is the other spelling');
assert.equal(one({ SubFileName: 'Oak.Street.2026.srt' }).name, 'Oak.Street.2026.srt', 'OpenSubtitles spelling');
assert.equal(one({ name: '  spaced  ' }).name, 'spaced', 'trimmed');
assert.equal(one({}).name, '', 'addons that say nothing stay silent, not "undefined"');
assert.equal(one({ name: 'x'.repeat(300) }).name.length, 120, 'capped so one addon cannot flood the menu');
// Control characters would break the label in the UI.
assert.equal(one({ name: 'a\nb\tc' }).name, 'a b c', 'newlines and tabs collapsed');

/* ------------------------------------------------- name from the URL */

// Neither addon in use sets a name, but SubDL puts the release in the URL's
// filename, which is the only thing that tells four Vietnamese entries apart.
const named = (url) => normalizeSubtitlePayload({ subtitles: [{ url, lang: 'vie' }] }, 'subdl')[0];
assert.equal(
  named('https://api3.subdl.com/f/TOK/The.End.of.Oak.Street.2026.1080p.WEBRip.x265.vi.srt').name,
  'The.End.of.Oak.Street.2026.1080p.WEBRip.x265',
  'filename, with the language and extension trimmed off',
);
assert.equal(
  named('https://x.test/a/My%20Film%202026%20WEB-DL.vi.srt').name,
  'My Film 2026 WEB-DL',
  'percent-encoding decoded',
);
// An opaque id is not a name; saying "1962602489" helps nobody.
assert.equal(named('https://subs5.strem.io/en/download/src-api/file/1962602489').name, '');
assert.equal(named('https://x.test/12345.srt').name, '', 'digits only is an id, not a release');
assert.equal(named('https://x.test/').name, '', 'no filename at all');
// An explicit name from the addon always wins over one guessed from the URL.
assert.equal(
  normalizeSubtitlePayload(
    { subtitles: [{ url: 'https://x.test/from-url.srt', lang: 'vie', name: 'From Addon' }] }, 'x',
  )[0].name,
  'From Addon',
);
console.log('ok - a release name is recovered from the URL when the addon omits it');

/* -------------------------------------------------------------- labels */

// With a name, show it — that is the whole point.
assert.equal(
  subtitleVariantLabel({ base: 'Tiếng Việt', name: '1080p.WEBRip.x264', source: 'subdl', index: 1 }),
  'Tiếng Việt · 1080p.WEBRip.x264',
);
// Without one, the addon it came from still tells them more than a bare count.
assert.equal(
  subtitleVariantLabel({ base: 'Tiếng Việt', name: '', source: 'opensubtitles-v3', index: 2 }),
  'Tiếng Việt · opensubtitles-v3 2',
);
// Nothing at all: the old counter, so a track never loses its identity.
assert.equal(
  subtitleVariantLabel({ base: 'Tiếng Việt', name: '', source: '', index: 3 }),
  'Tiếng Việt 3',
);
// A name that just repeats the language adds nothing; do not say it twice.
assert.equal(
  subtitleVariantLabel({ base: 'Tiếng Việt', name: 'Tiếng Việt', source: 'x', index: 1 }),
  'Tiếng Việt · x 1',
);
console.log('ok - online subtitle variants carry the release they were timed for');

/* ------------------------------------------------------- tick matching */

// A tick must mean same release, not same film: strict containment with a
// floor, so codec tags can never match alone.
assert.equal(
  releaseNamesMatch(
    'The.End.of.Oak.Street.2026.1080p.WEBRip.x265.HEVC.SUBTEKS.ME',
    'The.End.of.Oak.Street.2026.1080p.WEBRip.x265.HEVC.SUBTEKS.ME.vi.srt',
  ),
  true,
  'same release, either direction',
);
assert.equal(
  releaseNamesMatch(
    'Moana.2026.1080p.MA.WEB-DL.DDP5.1.Atmos.H.264',
    'Moana.2026.1080p.MA.WEB-DL.DDP5.1.Atmos.H.264.mkv',
  ),
  true,
  'sidecar name against the playing file, extension included',
);
assert.equal(
  releaseNamesMatch(
    'The.End.of.Oak.Street.2026.1080p.WEBRip.x265.HEVC.SUBTEKS.ME',
    'The End Of Oak Street 2026 1080p WEB-DL HEVC x265 10Bit DDP5.1.mkv',
  ),
  false,
  'WEBRip-named sidecar never ticks against a WEB-DL file',
);
assert.equal(
  releaseNamesMatch('Moana.2026.1080p.CAM.x264-DKS', 'Moana.2026.2160p.iTunes.WEB-DL.H.265-DreamHD.mkv'),
  false,
  'CAM sidecar never ticks against a WEB-DL file',
);
assert.equal(releaseNamesMatch('x264', 'Film.2026.1080p.WEB-DL.x264-GROUP.mkv'), false, 'codec tag alone is not a match');
assert.equal(releaseNamesMatch('WEB-DL', 'Film.2026.1080p.WEB-DL.x264-GROUP.mkv'), false, 'source tag alone is not a match');
assert.equal(releaseNamesMatch('Oak Street 2026', 'The End Of Oak Street 2026 1080p WEB-DL.mkv'), false, 'bare title is not a match');
assert.equal(releaseNamesMatch('', 'Film.2026.1080p.WEB-DL.x264-GROUP.mkv'), false, 'unnamed variants stay unticked');
assert.equal(releaseNamesMatch(null, undefined), false, 'missing names never match');
console.log('ok - the tick only fires on same-release names');
