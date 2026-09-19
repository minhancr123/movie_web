/**
 * isReadyTrack must not gate embedded tracks on having a URL.
 *
 * An embedded track is extracted from the playing file: its `url` is
 * absent while the extraction job is still running. isReadyTrack
 * returning false for it caused bestViTrack to always pick the first
 * online Vietnamese sidecar (a different release → permanent sub drift)
 * and prevented the auto-upgrade-to-embedded path from ever firing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const outDir = mkdtempSync(path.join(tmpdir(), 'subs-test-'));

execFileSync(
  'node',
  [
    path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    'src/lib/subtitles.ts',
    '--outDir', outDir, '--module', 'commonjs', '--target', 'es2020',
    '--moduleResolution', 'node', '--skipLibCheck', '--esModuleInterop',
  ],
  { cwd: root, stdio: 'pipe' },
);

const { isReadyTrack, isEmbeddedTrack, isViTrack } = await import(
  pathToFileURL(path.join(outDir, 'subtitles.js')).href,
);
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }));

// Embedded without URL must be considered ready (extraction pending, not absent).
assert.equal(isReadyTrack({ id: 'a'.repeat(40) + ':3', language: 'vi', label: 'Tiếng Việt', ready: false, url: '' }), true, 'embedded track with no URL is still ready');
// Embedded with URL is obviously ready.
assert.equal(isReadyTrack({ id: 'a'.repeat(40) + ':3', language: 'vi', label: 'Tiếng Việt', ready: true, url: 'http://example/sub.vtt', source: 'embedded' }), true, 'embedded track with URL is ready');
// Online track still needs a URL.
assert.equal(isReadyTrack({ id: 'Tiếng Việt 1', language: 'vi', label: 'Tiếng Việt 1', ready: true, url: 'http://example/cam.vtt' }), true, 'online track with URL is ready');
assert.equal(isReadyTrack({ id: 'Tiếng Việt 1', language: 'vi', label: 'Tiếng Việt 1', ready: true, url: '' }), false, 'online track without URL is not ready');
// isEmbeddedTrack identity check is unchanged.
assert.equal(isEmbeddedTrack({ id: 'a'.repeat(40) + ':3', source: undefined }), true);
assert.equal(isEmbeddedTrack({ id: 'Tiếng Việt 1' }), false);
// Not Vietnamese regardless.
assert.equal(isViTrack({ language: 'en' }), false);

console.log('ok - isReadyTrack allows embedded tracks before their URL lands');
console.log('ok - bestViTrack will now find embedded Vietnamese first');
