import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const outDir = mkdtempSync(path.join(tmpdir(), 'autoplay-'));

execFileSync(
    process.execPath,
    [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), 'src/lib/autoplay.ts',
        '--outDir', outDir, '--module', 'commonjs', '--target', 'es2020',
        '--moduleResolution', 'node', '--skipLibCheck'],
    { cwd: root, stdio: 'pipe' },
);

const { startPlaybackWithMutedFallback, loadingPresentation } = await import(
    pathToFileURL(path.join(outDir, 'autoplay.js')).href
);
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }));

const namedError = (name) => Object.assign(new Error(name), { name });

test('successful audible autoplay stays audible', async () => {
    const video = { muted: false, play: async () => undefined };
    assert.equal(await startPlaybackWithMutedFallback(video), 'playing');
    assert.equal(video.muted, false);
});

test('browser-blocked audible autoplay retries muted and starts playback', async () => {
    let calls = 0;
    const video = {
        muted: false,
        play: async () => {
            calls += 1;
            if (calls === 1) throw namedError('NotAllowedError');
        },
    };
    assert.equal(await startPlaybackWithMutedFallback(video), 'playing-muted');
    assert.equal(calls, 2);
    assert.equal(video.muted, true);
});

test('an interrupted load is ignored instead of being reported as blocked', async () => {
    const video = { muted: false, play: async () => { throw namedError('AbortError'); } };
    assert.equal(await startPlaybackWithMutedFallback(video), 'aborted');
    assert.equal(video.muted, false);
});

test('a failed muted retry restores the original audible preference', async () => {
    const video = { muted: false, play: async () => { throw namedError('NotAllowedError'); } };
    assert.equal(await startPlaybackWithMutedFallback(video), 'blocked');
    assert.equal(video.muted, false);
});

test('a previously playing seek shows buffering rather than a fabricated Safari permission prompt', () => {
 assert.equal(loadingPresentation({loading:true,blocked:false,hasPlayed:true,paused:true}),'spinner');
 assert.equal(loadingPresentation({loading:true,blocked:false,hasPlayed:true,paused:false}),'spinner');
 assert.equal(loadingPresentation({loading:true,blocked:true,hasPlayed:true,paused:true}),'permission-play');
 assert.equal(loadingPresentation({loading:true,blocked:false,hasPlayed:false,paused:true}),'initial-play');
 assert.equal(loadingPresentation({loading:false,blocked:false,hasPlayed:true,paused:true}),'none');
});
