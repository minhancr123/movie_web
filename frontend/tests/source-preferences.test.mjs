import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const load = (name, globals = {}) => {
  const file = new URL(`../src/lib/${name}.ts`, import.meta.url);
  if (!existsSync(file)) return null;
  const context = { exports: {}, ...globals };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports;
};
const device = (width, height, coarse) => ({
  window: { screen: { width, height }, devicePixelRatio: 3,
    matchMedia: q => ({ matches: q === '(pointer: coarse)' ? coarse : true }) },
  document: { createElement: () => ({ canPlayType: () => 'probably' }) }, navigator: {},
});
test('phone Auto prefers 1080p in both orientations while retaining HEVC/HDR support', () => {
  for (const [w, h] of [[430, 932], [932, 430]]) {
    const caps = load('capabilities', device(w, h, true)).detectCapabilities();
    assert.equal(caps.preferredMaxHeight, 1080);
    assert.equal(caps.hevc, true);
    assert.equal(caps.hdr, true);
  }
});
test('a desktop is not forced into the phone preference and SSR stays usable', () => {
  assert.equal(load('capabilities', device(1920, 1080, false)).detectCapabilities().preferredMaxHeight, 0);
  assert.equal(load('capabilities').detectCapabilities().preferredMaxHeight, 0);
});
test('source groups expose direct Vietsub and every available resolution, excluding rejected entries', () => {
  const api = load('source-groups');
  assert.equal(typeof api?.groupPlaybackSources, 'function', 'grouped picker must exist');
  const groups = api.groupPlaybackSources([
    { sourceToken: '4k', resolution: 2160 }, { sourceToken: '1080', resolution: 1080 },
    { sourceToken: '720', resolution: 720 }, { sourceToken: 'yastream:0:x', origin: 'yastream' },
    { sourceToken: 'vimo|movie|x' }, { sourceToken: 'reject', resolution: 2160, playable: false },
  ]);
  assert.deepEqual(Array.from(groups, g => g.key), ['vietsub', '1080p', '720p', '4k']);
  assert.equal(groups[0].sources.length, 2);
  assert.equal(groups.find(g => g.key === '4k').sources[0].sourceToken, '4k');
  assert.equal(groups.flatMap(g => g.sources).length, 5);
  assert.equal(api.groupPlaybackSources([]).length, 0);
});
test('1440p is a named group here too, matching the backend bands', () => {
  const api = load('source-groups');
  const groups = api.groupPlaybackSources([
    { sourceToken: 'mid', resolution: 1440 }, { sourceToken: 'low', resolution: 480 },
    { sourceToken: 'none', resolution: null },
  ]);
  // Display order stays cheap-before-expensive, as it was before 1440p existed:
  // 720p is a data-saver bucket, so it leads and 1440p sits between it and 4K.
  assert.deepEqual(Array.from(groups, g => g.key), ['720p', '1440p', 'other']);
  assert.equal(groups[0].label.includes('720p'), true, '720p and below share the data-saver label');
  const qhd = groups.find(g => g.key === '1440p');
  assert.equal(qhd.sources[0].sourceToken, 'mid', 'a 1440p release is never filed as "other"');
  assert.equal(qhd.label.includes('1440p'), true);
});
test("the backend's qualityGroup wins, so client and server cannot drift", () => {
  const api = load('source-groups');
  const grouped = api.groupPlaybackSources([
    { sourceToken: 'tagged', resolution: 1440, qualityGroup: '1080p' },
    { sourceToken: 'bogus', resolution: 1080, qualityGroup: 'not-a-group' },
  ]);
  assert.equal(grouped[0].key, '1080p');
  assert.equal(grouped[0].sources[0].sourceToken, 'tagged', 'a known bucket is taken as sent');
  // An unrecognised bucket falls back to the local bands rather than vanishing.
  assert.equal(grouped[0].sources[1].sourceToken, 'bogus');
});
