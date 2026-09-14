/**
 * Edge sampling for the ambient glow.
 *
 * Three things here decide whether the glow reads as light or as a coloured
 * border: letterbox handling (almost every film is wider than 16:9, and a naive
 * top sample reads the black bar), per-zone variation along each edge, and
 * averaging in linear light rather than in gamma-encoded sRGB.
 *
 * Compiled with the project's own tsc into a temp dir, like the audio tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const outDir = mkdtempSync(path.join(tmpdir(), 'ambilight-'));

execFileSync(
    process.execPath,
    [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), 'src/lib/ambilight.ts',
        '--outDir', outDir, '--module', 'commonjs', '--target', 'es2020',
        '--moduleResolution', 'node', '--skipLibCheck'],
    { cwd: root, stdio: 'pipe' },
);

const {
    averageEdge, averageZone, sampleZones, vivid, toCss,
    lerpRgb, lerpZones, blackZones, maxZoneDelta,
    SAMPLE_SIZE, LETTERBOX_LUMA, ZONE_COUNTS,
} = await import(pathToFileURL(path.join(outDir, 'ambilight.js')).href);
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }));

/* ------------------------------------------------------------- fixtures */

const SIZE = SAMPLE_SIZE;

/** Builds an RGBA frame from a (x, y) -> [r,g,b] function. */
const frame = (paint) => {
    const px = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
            const [r, g, b] = paint(x, y);
            const i = (y * SIZE + x) * 4;
            px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
        }
    }
    return px;
};

const BARS = 3; // rows of letterbox top and bottom
const letterboxed = (picture) => frame((x, y) =>
    (y < BARS || y >= SIZE - BARS) ? [0, 0, 0] : picture(x, y));

const near = (actual, expected, tol, msg) =>
    assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, want ~${expected}`);

/* --------------------------------------------------------- letterboxing */

test('letterbox bars are skipped, not sampled', () => {
    const px = letterboxed(() => [220, 30, 30]);
    const top = averageEdge(px, SIZE, 'top');
    assert.ok(top[0] > 150, `top edge must read the picture, not the bar (got ${top})`);
    assert.ok(top[0] > top[1] && top[0] > top[2], 'and must stay red');

    const bottom = averageEdge(px, SIZE, 'bottom');
    assert.ok(bottom[0] > 150, `bottom edge must also skip its bar (got ${bottom})`);
});

test('an all-black frame stays black rather than inventing colour', () => {
    // A fade to black genuinely has no colour; guessing one would pulse the
    // glow during exactly the moments a film means to go dark.
    const px = frame(() => [0, 0, 0]);
    for (const edge of ['top', 'right', 'bottom', 'left']) {
        assert.deepEqual(averageEdge(px, SIZE, edge), [0, 0, 0], `${edge} must stay black`);
    }
});

test('dark picture detail is kept while true bars are dropped', () => {
    const dark = LETTERBOX_LUMA + 12;
    const px = letterboxed(() => [dark, dark, dark]);
    const top = averageEdge(px, SIZE, 'top');
    near(top[0], dark, 3, 'shadow detail must survive the letterbox filter');
});

/* ------------------------------------------------------- linear averaging */

test('averaging happens in linear light, not in gamma-encoded sRGB', () => {
    // Half the columns full red, half black. Averaging the encoded values gives
    // ~128; averaging the light they represent and re-encoding gives ~182. The
    // first is the muddy result that makes a glow look like dirt.
    const px = frame((x) => (x % 2 === 0 ? [255, 0, 0] : [0, 0, 0]));
    const top = averageEdge(px, SIZE, 'top');
    assert.ok(top[0] > 170, `linear average expected ~182, got ${top[0]}`);
    assert.ok(top[0] < 195, `should not exceed the linear result either, got ${top[0]}`);
});

/* ------------------------------------------------------------- zoning */

test('zones vary along an edge instead of washing it one colour', () => {
    // Left half of the picture red, right half blue. A single average per edge
    // would paint the whole top a dull purple; zones must keep the sides apart.
    const px = letterboxed((x) => (x < SIZE / 2 ? [230, 20, 20] : [20, 20, 230]));
    const { top } = sampleZones(px);

    assert.equal(top.length, ZONE_COUNTS.top, 'zone count must follow the config');
    const first = top[0];
    const last = top[top.length - 1];
    assert.ok(first[0] > first[2], `leftmost zone should be red, got ${first}`);
    assert.ok(last[2] > last[0], `rightmost zone should be blue, got ${last}`);
});

test('side zones run top-to-bottom, long edges left-to-right', () => {
    // Top band green, bottom band magenta, so the left edge must differ along
    // its length — that only works if the sides are zoned vertically.
    const px = frame((x, y) => (y < SIZE / 2 ? [20, 230, 20] : [230, 20, 230]));
    const { left } = sampleZones(px);
    assert.equal(left.length, ZONE_COUNTS.left);
    assert.ok(left[0][1] > left[0][0], `first left zone should be green, got ${left[0]}`);
    const bottomZone = left[left.length - 1];
    assert.ok(bottomZone[0] > bottomZone[1], `last left zone should be magenta, got ${bottomZone}`);
});

test('every column of the edge lands in some zone', () => {
    // Proven through the public API rather than by re-deriving the bounds: if
    // any column fell between two zones, a bright stripe there would leave every
    // zone unchanged and that slice of the picture would never light anything.
    const dark = sampleZones(frame(() => [30, 30, 30])).top;
    for (let x = 0; x < SIZE; x += 1) {
        const lit = sampleZones(frame((cx) => (cx === x ? [255, 255, 255] : [30, 30, 30]))).top;
        const moved = lit.some((zone, i) => Math.abs(zone[0] - dark[i][0]) > 1);
        assert.ok(moved, `column ${x} is not covered by any top zone`);
    }
});

/* ------------------------------------------------------------- colour */

test('vivid lifts saturation but clamps lightness both ways', () => {
    const [r, g, b] = vivid([255, 255, 255]);
    assert.ok(Math.max(r, g, b) < 255, 'a blown highlight must not become a lamp');
    const dim = vivid([20, 0, 0]);
    assert.ok(Math.max(...dim) > 20, 'a dim scene must still register as lit');
    const grey = vivid([128, 128, 128]);
    near(grey[0], grey[1], 1, 'grey must stay neutral');
    near(grey[1], grey[2], 1, 'grey must stay neutral');
});

test('a night scene is allowed to stay dark', () => {
    // The old floor lifted everything to a visible glow, which is the other
    // half of what makes a fake Ambilight obvious.
    const night = vivid([12, 14, 30]);
    assert.ok(Math.max(...night) < 110, `night must stay dim, got ${night}`);
});

/* ------------------------------------------------------------ smoothing */

test('lerp eases toward the target and lands exactly on it', () => {
    assert.deepEqual(lerpRgb([0, 0, 0], [100, 200, 40], 0), [0, 0, 0]);
    assert.deepEqual(lerpRgb([0, 0, 0], [100, 200, 40], 1), [100, 200, 40]);
    assert.deepEqual(lerpRgb([0, 0, 0], [100, 200, 40], 0.5), [50, 100, 20]);
});

test('lerpZones moves every zone of every edge', () => {
    const from = blackZones();
    const to = sampleZones(frame(() => [200, 100, 50]));
    const mid = lerpZones(from, to, 0.5);
    for (const edge of ['top', 'right', 'bottom', 'left']) {
        assert.equal(mid[edge].length, from[edge].length, `${edge} keeps its zone count`);
        for (let i = 0; i < mid[edge].length; i += 1) {
            near(mid[edge][i][0], to[edge][i][0] / 2, 0.001, `${edge}[${i}] must be halfway`);
        }
    }
});

test('lerpZones survives a target with a different zone count', () => {
    // Mismatched shapes would otherwise read undefined and paint NaN colours.
    const from = blackZones();
    const to = { ...blackZones(), top: [[255, 0, 0]] };
    const mid = lerpZones(from, to, 0.5);
    assert.equal(mid.top.length, from.top.length);
    for (const c of mid.top) for (const ch of c) assert.ok(Number.isFinite(ch), 'no NaN channels');
});

/* --------------------------------------------------------- repaint gate */

test('maxZoneDelta sees a change in any zone of any edge', () => {
    // The repaint gate reads this. A cheaper hash over a few channels would let
    // every zone it does not cover freeze while the rest of the light moved,
    // so every zone of every edge has to be able to trigger a repaint.
    const base = blackZones();
    assert.equal(maxZoneDelta(base, blackZones()), 0, 'identical zones must read as no change');

    for (const edge of ['top', 'right', 'bottom', 'left']) {
        for (let i = 0; i < base[edge].length; i += 1) {
            for (let c = 0; c < 3; c += 1) {
                const moved = blackZones();
                moved[edge][i][c] = 9;
                assert.equal(maxZoneDelta(base, moved), 9, `${edge}[${i}] channel ${c} must be visible`);
            }
        }
    }
});

test('maxZoneDelta reports the largest move, not the last one', () => {
    const a = blackZones();
    const b = blackZones();
    b.top[0][0] = 4;
    b.bottom[1][2] = 30;
    b.left[0][1] = 7;
    assert.equal(maxZoneDelta(a, b), 30);
});

test('a mismatched shape always forces a repaint', () => {
    // Comparing zone lists of different lengths cannot be meaningful; the safe
    // answer is "changed" rather than silently comparing the overlap.
    const odd = { ...blackZones(), top: [[0, 0, 0]] };
    assert.equal(maxZoneDelta(blackZones(), odd), Infinity);
});

/* ------------------------------------------------------------- output */

test('sampleZones returns in-range colours on every edge', () => {
    const colors = sampleZones(letterboxed(() => [200, 40, 40]));
    assert.deepEqual(Object.keys(colors).sort(), ['bottom', 'left', 'right', 'top']);
    for (const [edge, zones] of Object.entries(colors)) {
        assert.equal(zones.length, ZONE_COUNTS[edge]);
        for (const rgb of zones) {
            assert.equal(rgb.length, 3, `${edge} zone must be an rgb triple`);
            for (const c of rgb) {
                assert.ok(Number.isFinite(c) && c >= 0 && c <= 255, `${edge} channel out of range: ${c}`);
            }
        }
    }
    assert.match(toCss(colors.top[0], 0.5), /^rgba\(\d+, \d+, \d+, 0\.5\)$/);
});
