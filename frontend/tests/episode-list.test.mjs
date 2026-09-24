import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const outDir = mkdtempSync(path.join(tmpdir(), 'episode-list-'));
execFileSync(process.execPath,
    [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), 'src/lib/episode-list.ts',
        '--outDir', outDir, '--module', 'commonjs', '--target', 'es2020',
        '--moduleResolution', 'node', '--skipLibCheck'],
    { cwd: root, stdio: 'pipe' });
const { episodeScrollTarget } = await import(pathToFileURL(path.join(outDir, 'episode-list.js')).href);
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }));

// One card is 176px wide (w-44) plus a 12px gap: episode N starts at N*188.
const strip = { cardWidth: 176, containerWidth: 829, contentWidth: 188 * 25 };

test('an episode further along the strip is brought to the left edge', () => {
    // Episode 6 (index 5) sits past the right edge of an 829px viewport.
    const target = episodeScrollTarget({ ...strip, cardOffsetLeft: 188 * 5, currentScrollLeft: 0 });
    // Its own left edge is a snap-start position, so mandatory snapping leaves
    // it exactly there instead of re-snapping to a neighbour.
    assert.equal(target, 940);
});

test('an episode already fully on screen is left alone', () => {
    // Episode 2 (index 1) is wholly inside the viewport at scrollLeft 0.
    assert.equal(episodeScrollTarget({ ...strip, cardOffsetLeft: 188, currentScrollLeft: 0 }), 0);
    // Same card once the viewer has scrolled a little themselves: no yank back.
    assert.equal(episodeScrollTarget({ ...strip, cardOffsetLeft: 188, currentScrollLeft: 100 }), 100);
});

test('an episode behind the current position scrolls back to it', () => {
    assert.equal(episodeScrollTarget({ ...strip, cardOffsetLeft: 188, currentScrollLeft: 940 }), 188);
});

test('the last episodes clamp to the end of the strip', () => {
    const maxScroll = strip.contentWidth - strip.containerWidth; // 3871
    assert.equal(
        episodeScrollTarget({ ...strip, cardOffsetLeft: 188 * 24, currentScrollLeft: 0 }),
        maxScroll,
    );
});

test('an unmeasured strip is never scrolled', () => {
    // Ref callbacks can run before the panel has laid out; scrolling on those
    // numbers would land at 0 and look like the feature simply does not work.
    assert.equal(
        episodeScrollTarget({ ...strip, containerWidth: 0, cardOffsetLeft: 940, currentScrollLeft: 120 }),
        120,
    );
    assert.equal(
        episodeScrollTarget({ ...strip, cardWidth: 0, cardOffsetLeft: 940, currentScrollLeft: 120 }),
        120,
    );
    assert.equal(
        episodeScrollTarget({ ...strip, cardOffsetLeft: Number.NaN, currentScrollLeft: 120 }),
        120,
    );
});
