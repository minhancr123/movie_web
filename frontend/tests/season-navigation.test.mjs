import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Compile the pure helper the same way playback-progress.test.mjs does, so the
// test exercises the shipped code rather than a regex over its source.
const root = path.resolve(import.meta.dirname, '..');
const outDir = mkdtempSync(path.join(tmpdir(), 'season-navigation-'));

execFileSync(
    process.execPath,
    [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), 'src/lib/season-navigation.ts',
        '--outDir', outDir, '--module', 'commonjs', '--target', 'es2020',
        '--moduleResolution', 'node', '--skipLibCheck'],
    { cwd: root, stdio: 'pipe' },
);

const { nextSeasonNumber, firstAvailableEpisode, isLastEpisode } = await import(pathToFileURL(path.join(outDir, 'season-navigation.js')).href);

test('next season follows catalog numbering rather than assuming contiguous seasons', () => {
 assert.equal(nextSeasonNumber([{seasonNumber:3},{seasonNumber:1},{seasonNumber:0}],1),3);
 assert.equal(nextSeasonNumber([{seasonNumber:1}],1),null);
 assert.equal(nextSeasonNumber([{seasonNumber:1}],null),null);
});
test('next season starts at its first episode and never skips an unaired opener', () => {
 assert.equal(firstAvailableEpisode([{episodeNumber:2},{episodeNumber:1,airDate:'2020-01-01'}],'2026-10-26').episodeNumber,1);
 assert.equal(firstAvailableEpisode([{episodeNumber:1,airDate:'2027-01-01'},{episodeNumber:2,airDate:'2020-01-01'}],'2026-10-26'),undefined);
 assert.equal(firstAvailableEpisode([]),undefined);
});
test('cross-season advance is only possible at the actual last catalog episode', () => {
 assert.equal(isLastEpisode([{episodeNumber:1},{episodeNumber:7}],7),true);
 assert.equal(isLastEpisode([{episodeNumber:1},{episodeNumber:7}],1),false);
 assert.equal(isLastEpisode([{episodeNumber:1},{episodeNumber:7}],8),false);
 assert.equal(isLastEpisode([],null),false);
});
rmSync(outDir,{recursive:true,force:true});
