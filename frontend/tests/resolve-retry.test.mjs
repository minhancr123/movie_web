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
const outDir = mkdtempSync(path.join(tmpdir(), 'resolve-retry-'));

execFileSync(
    process.execPath,
    [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), 'src/lib/resolve-retry.ts',
        '--outDir', outDir, '--module', 'commonjs', '--target', 'es2020',
        '--moduleResolution', 'node', '--skipLibCheck'],
    { cwd: root, stdio: 'pipe' },
);

const { BUSY_RETRY_ATTEMPTS, busyRetryDelayMs } = await import(
    pathToFileURL(path.join(outDir, 'resolve-retry.js')).href
);

test('the ladder keeps its 3 attempts', () => {
    assert.equal(BUSY_RETRY_ATTEMPTS, 3);
});

for (const [attempt, lo, hi] of [[1, 5000, 8000], [2, 10000, 15000], [3, 15000, 20000]]) {
    test(`attempt ${attempt} spreads inside [${lo}, ${hi}) with jitter`, () => {
        // Enough samples that a broken generator cannot hide behind luck, but
        // only range assertions: exact values are random by design.
        let sawLow = false;
        let sawHigh = false;
        for (let i = 0; i < 60; i += 1) {
            const wait = busyRetryDelayMs(attempt);
            assert.ok(wait >= lo && wait < hi, `attempt ${attempt} out of band: ${wait}`);
            if (wait < lo + (hi - lo) / 2) sawLow = true;
            else sawHigh = true;
        }
        assert.ok(sawLow && sawHigh, `attempt ${attempt} shows no spread`);
    });
}

test('attempts past the ladder clamp to the last band', () => {
    for (let i = 0; i < 20; i += 1) {
        const wait = busyRetryDelayMs(99);
        assert.ok(wait >= 15000 && wait < 20000, `clamped attempt out of band: ${wait}`);
    }
});

test('junk attempts fall back to the first band, never NaN', () => {
    for (const junk of [0, -2, NaN, undefined]) {
        const wait = busyRetryDelayMs(junk);
        assert.ok(wait >= 5000 && wait < 8000, `junk attempt out of band: ${wait}`);
    }
});

rmSync(outDir, { recursive: true, force: true });
