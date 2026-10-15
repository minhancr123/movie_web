import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.resolve(import.meta.dirname, '..');
const out = mkdtempSync(path.join(tmpdir(), 'playback-extras-'));
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), 'src/lib/playback-extras.ts', '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'], { cwd: root });
const { nextPlayableEpisode, activeSkipMark, seekPreviewPosition, fallbackPlaybackNotice } = await import(pathToFileURL(path.join(out, 'playback-extras.js')).href);
process.on('exit', () => rmSync(out, { recursive: true, force: true }));
test('next episode uses real episode numbers, never loops or jumps into an unaired episode', () => {
  const episodes = [{ episodeNumber: 3 }, { episodeNumber: 1 }, { episodeNumber: 2, airDate: '2026-10-16' }];
  assert.equal(nextPlayableEpisode(episodes, 1, '2026-10-15'), undefined);
  assert.equal(nextPlayableEpisode(episodes, 1, '2026-10-16').episodeNumber, 2);
  assert.equal(nextPlayableEpisode(episodes, 3), undefined);
  assert.equal(nextPlayableEpisode(episodes, null), undefined);
  assert.equal(nextPlayableEpisode(episodes, 99), undefined);
});
test('skip markers use absolute film time, hide outside the interval and preserve post-credit scenes', () => {
  const intro = { kind: 'intro', start: 60, end: 150 };
  assert.equal(activeSkipMark([intro], 59.9, 3600, false), undefined);
  assert.equal(activeSkipMark([intro], 90, 3600, false), intro);
  assert.equal(activeSkipMark([intro], 150, 3600, false), undefined);
  const credits = { kind: 'credits', start: 3500, end: 3600 };
  assert.equal(activeSkipMark([credits], 3550, 3600, false), undefined, 'no seek beyond EOF on a final episode');
  assert.equal(activeSkipMark([credits], 3550, 3600, true), credits);
  const postCredits = { kind: 'credits', start: 3200, end: 3400 };
  assert.equal(activeSkipMark([postCredits], 3300, 3600, false), postCredits);
  assert.equal(activeSkipMark([intro], 90, 100, false), undefined, 'reject markers for a different cut');
});
test('hover times span the full film, not just the written HLS prefix', () => {
  assert.deepEqual(seekPreviewPosition(550, 100, 600, 7200), { at: 5400, percent: 75 });
  assert.equal(seekPreviewPosition(0, 100, 600, 7200).at, 0);
  assert.equal(seekPreviewPosition(900, 100, 600, 7200).at, 7199.9);
  assert.equal(seekPreviewPosition(1, 0, 0, 7200), null);
});

test('fallback wording identifies disk exhaustion without claiming that seeking repairs it', () => {
  assert.match(fallbackPlaybackNotice('REMUX_NO_SPACE'), /thiếu dung lượng/);
  assert.doesNotMatch(fallbackPlaybackNotice('VIDEO_TRANSCODE_FORBIDDEN'), /tải quá chậm|tua lại/);
  assert.doesNotMatch(fallbackPlaybackNotice(), /tải quá chậm|tua lại/);
});
