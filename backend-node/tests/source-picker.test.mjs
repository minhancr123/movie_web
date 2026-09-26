import test from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates, normalizeCapabilities, isPreferredAutoSource, hasKnownHeight } from '../services/playback/sourceRanker.js';

const caps = { hevc: true, hdr: true, maxHeight: 2160, maxBitrateMbps: 0 };
const make = (height, i = 0) => ({
  infoHash: (height + i).toString(16).padStart(40, '0'),
  filename: `Lanterns.S01E05.${height}p.WEB-DL.${height === 2160 ? 'DV.HEVC' : 'H264'}.AAC.Group${i}.mkv`,
  cached: true, seeds: 20,
  sizeBytes: height === 2160 ? 6e9 : height === 1080 ? 2e9 : 1e9,
});
const candidates = [...Array.from({ length: 20 }, (_, i) => make(2160, i)), make(1080), make(720)];
const options = { runtimeMinutes: 53, expectedTitles: ['Lanterns'] };

test('phone Auto chooses 1080p without removing manually selectable 4K', () => {
  const result = rankCandidates(candidates, { ...caps, preferredMaxHeight: 1080 }, options);
  assert.equal(result.best.resolution, 1080);
  assert(result.playable.some(s => s.infoHash === candidates[0].infoHash && s.resolution === 2160));
});
test('phone prefers available 1080p over a higher-bitrate 720p release', () => {
  const highBitrate720 = { ...make(720), sizeBytes: 2e9 };
  const result = rankCandidates([make(1080), highBitrate720, make(2160)], { ...caps, preferredMaxHeight: 1080 }, options);
  assert.equal(result.best.resolution, 1080);
});

test('phone falls back to 720p ahead of 4K when 1080p is absent', () => {
  const result = rankCandidates([make(2160), make(720)], { ...caps, preferredMaxHeight: 1080 }, options);
  assert.equal(result.best.resolution, 720);
});
test('desktop and older clients retain their existing quality ranking', () => {
  assert.equal(rankCandidates(candidates, caps, options).best.resolution, 2160);
  assert.equal(rankCandidates([make(2160)], { ...caps, preferredMaxHeight: 1080 }, options).best.resolution, 2160);
});
test('phone preference never sends Auto to an uncached zero-seed source ahead of a ready fallback', () => {
  const unavailable = { ...make(1080), cached: false, seeds: 0 };
  const result = rankCandidates([unavailable, make(2160)], { ...caps, preferredMaxHeight: 1080 }, options);
  assert.equal(result.best.resolution, 2160);
});
test('a cached 4K does not outrank a downloadable 1080p on a phone', () => {
  // The hole: readiness was compared before height, so "phone ⇒ 1080p" held
  // only until TorBox happened to hold the 4K — and the phone then paid 4K
  // bandwidth for it.
  const result = rankCandidates([make(2160), { ...make(1080), cached: false }], { ...caps, preferredMaxHeight: 1080 }, options);
  assert.equal(result.best.resolution, 1080, 'height preference outranks cached');
  // Within the band, readiness still decides.
  const bothCached = rankCandidates([make(2160), make(1080)], { ...caps, preferredMaxHeight: 1080 }, options);
  assert.equal(bothCached.best.resolution, 1080);
  // And a phone that only has 4K cached still gets it, rather than nothing.
  assert.equal(rankCandidates([make(2160)], { ...caps, preferredMaxHeight: 1080 }, options).best.resolution, 2160);
});
test('the preferred band needs an obtainable release, not just a fitting label', () => {
  assert.equal(isPreferredAutoSource({ resolution: 1080, cached: true, seeds: 0 }, 1080), true, 'already held');
  assert.equal(isPreferredAutoSource({ resolution: 1080, cached: false, seeds: 20 }, 1080), true, 'downloadable');
  assert.equal(isPreferredAutoSource({ resolution: 1080, cached: false, seeds: 0 }, 1080), false, '0-seed, not held');
  assert.equal(isPreferredAutoSource({ resolution: 2160, cached: true, seeds: 0 }, 1080), false, 'too tall');
  assert.equal(isPreferredAutoSource({ resolution: null, cached: true, seeds: 0 }, 1080), false, 'unknown height claims nothing');
  assert.equal(isPreferredAutoSource({ resolution: 1080, cached: true, seeds: 0 }, 0), false, 'no preference expressed');
  assert.equal(hasKnownHeight({ resolution: null }), false);
  assert.equal(hasKnownHeight({ resolution: 0 }), false);
  assert.equal(hasKnownHeight({ resolution: '1080' }), true);
});
test('invalid quality preferences do not change playback capability', () => {
  for (const value of [NaN, Infinity, -1, 'garbage']) {
    assert.equal(normalizeCapabilities({ ...caps, preferredMaxHeight: value }).preferredMaxHeight, 0);
  }
  assert.equal(normalizeCapabilities({ ...caps, preferredMaxHeight: 1080 }).maxHeight, 2160);
});

const picker = await import('../services/playback/sourcePicker.js').catch(() => null);
test('Auto cannot reuse 4K ahead of a ready preferred source; manual 4K still reuses', () => {
  assert.equal(typeof picker?.selectReuseCandidates, 'function');
  const attempts = [{ ...make(1080), resolution: 1080 }, { ...make(2160), resolution: 2160 }];
  assert.deepEqual(picker.selectReuseCandidates(attempts, 1080).map(s => s.resolution), [1080]);
  assert.deepEqual(picker.selectReuseCandidates([attempts[1]], 1080, true).map(s => s.resolution), [2160]);
  assert.equal(picker.selectReuseCandidates(attempts, 0).length, 2);
  assert.equal(picker.selectReuseCandidates([{ ...attempts[0], cached: false }, attempts[1]], 1080).length, 2);
});
test('a release with no stated height keeps its reuse fast path on a phone', () => {
  // Regression: the scan filtered on "fits the preference", and an unparsed
  // label does not fit it — so an existing, ready session became invisible and
  // a 2-second reuse turned into a full TorBox prepare.
  const unparsed = { ...make(1080), resolution: null, infoHash: 'unparsed' };
  const parsed = { ...make(1080), resolution: 1080 };
  assert.deepEqual(
    picker.selectReuseCandidates([parsed, unparsed], 1080).map(s => s.infoHash),
    [parsed.infoHash, unparsed.infoHash],
  );
  // Still filtered out when it IS too tall: only "unknown" is spared.
  const tall = { ...make(2160), resolution: 2160 };
  assert.deepEqual(picker.selectReuseCandidates([parsed, tall], 1080).map(s => s.resolution), [1080]);
});
test('1440p is a named bucket, and only heightless releases land in "other"', () => {
  const tagged = picker.selectDiverseSources([
    { sourceToken: 'q', resolution: 1440 },
    { sourceToken: 'q', resolution: 2160 },
    { sourceToken: 's', resolution: 1080 },
    { sourceToken: 'l', resolution: 480 },
    { sourceToken: 'n', resolution: null },
  ], 15);
  const groupOf = (token) => tagged.find(s => s.sourceToken === token).qualityGroup;
  assert.equal(groupOf('q'), '1440p');
  assert.equal(groupOf('s'), '1080p');
  assert.equal(groupOf('l'), '720p', '720 and below share the data-saver bucket');
  assert.equal(groupOf('n'), 'other', 'a release that states no height is the only "other"');
  assert.ok(!tagged.some(s => s.resolution === 1440 && s.qualityGroup === 'other'));
  // A flood of 4K must not push 1440p out of the 15 slots.
  const flooded = picker.selectDiverseSources([
    { sourceToken: 'mid', resolution: 1440 },
    ...Array.from({ length: 20 }, (_, i) => ({ sourceToken: `4k${i}`, resolution: 2160 })),
  ], 15);
  assert.equal(flooded.filter(s => s.resolution === 1440).length, 1);
});
test('15 slots retain Vietsub, 1080p and 720p despite a flood of 4K sources', () => {
  assert.equal(typeof picker?.selectDiverseSources, 'function', 'diverse source selector must exist');
  const ranked = rankCandidates(candidates, caps, options).playable.map(s => ({ ...s, sourceToken: s.infoHash }));
  const input = [...ranked, { sourceToken: 'vimo|series|fixture:1:5', origin: 'vimo', playable: true }];
  const output = picker.selectDiverseSources(input);
  assert.equal(output.length, 15);
  assert.deepEqual([...new Set(output.map(s => s.qualityGroup))].sort(), ['1080p', '4k', '720p', 'vietsub']);
  assert.equal(output.filter(s => s.resolution === 1080).length, 1);
  assert.equal(output.filter(s => s.resolution === 720).length, 1);
});
test('picker removes rejected and duplicate tokens without inventing unavailable qualities', () => {
  assert.equal(typeof picker?.selectDiverseSources, 'function');
  const output = picker.selectDiverseSources([
    { sourceToken: 'a', resolution: 1080 }, { sourceToken: 'a', resolution: 1080 },
    { sourceToken: 'blocked', resolution: 720, playable: false },
    { sourceToken: 'b', resolution: 2160 },
  ]);
  assert.deepEqual(output.map(s => s.sourceToken), ['a', 'b']);
  assert.deepEqual(picker.selectDiverseSources([], 15), []);
  assert.equal(picker.selectDiverseSources(output, 1).length, 1);
});
