/**
 * Edge-colour sampling for the ambient glow behind the player.
 *
 * Deliberately free of DOM and React so the maths can be exercised directly:
 * everything here works on a plain RGBA buffer of a downscaled frame.
 */

export type Rgb = [number, number, number];
export type Edge = 'top' | 'right' | 'bottom' | 'left';
/** Colours along each edge, ordered left-to-right (top/bottom) or top-to-bottom. */
export type AmbientZones = Record<Edge, Rgb[]>;

/** The frame is drawn this small before reading it back; 256 px is plenty. */
export const SAMPLE_SIZE = 16;
/** How many rows/columns of actual picture to average per zone. */
export const EDGE_BAND = 3;
/**
 * Below this mean luminance a line is treated as letterbox rather than picture.
 * Real shadow detail in a graded film still sits above it; true bars are 0-4.
 */
export const LETTERBOX_LUMA = 10;

/**
 * Zones per edge. A single colour per side is the tell that gives a fake
 * Ambilight away: real light from a screen varies along its length, so a
 * character lit red on the left cannot wash the whole top edge red. The long
 * edges get more zones than the short ones simply because they are longer.
 */
export const ZONE_COUNTS: Record<Edge, number> = { top: 5, right: 3, bottom: 5, left: 3 };

const luma = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * sRGB is gamma-encoded, so averaging its values directly is averaging the wrong
 * numbers: mixing full red with full green that way yields a muddy dark olive
 * rather than the bright yellow the eye expects. Averaging happens in linear
 * light and converts back at the end.
 */
const toLinear = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (l: number): number => {
    const v = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, v * 255));
};

/**
 * Mean colour of one row or column, restricted to the span `lo..hi` across it.
 * For `axis: 'row'`, `index` is the row and the span is columns; for `'col'` the
 * other way round.
 */
const segmentAverage = (
    pixels: Uint8ClampedArray,
    size: number,
    axis: 'row' | 'col',
    index: number,
    lo: number,
    hi: number,
): Rgb => {
    let r = 0;
    let g = 0;
    let b = 0;
    const n = hi - lo + 1;
    for (let i = lo; i <= hi; i += 1) {
        const px = (axis === 'row' ? index * size + i : i * size + index) * 4;
        r += toLinear(pixels[px]);
        g += toLinear(pixels[px + 1]);
        b += toLinear(pixels[px + 2]);
    }
    // Kept in linear light; the caller converts once the averaging is finished.
    return [r / n, g / n, b / n];
};

/**
 * Averages one zone of one edge, scanning inward past any letterbox.
 *
 * A 2.39:1 film in a 16:9 frame is bordered by pure black bars, and sampling
 * them straight would light the room with nothing at all — the top and bottom
 * glow would simply never come on. So black lines are skipped and the first
 * `band` lines of real picture are averaged instead.
 *
 * A frame that is black all the way through (a fade, or the gap between scenes)
 * legitimately has no colour, and returns black rather than inventing one.
 */
export function averageZone(
    pixels: Uint8ClampedArray,
    size: number,
    edge: Edge,
    lo: number,
    hi: number,
    band: number = EDGE_BAND,
): Rgb {
    const axis: 'row' | 'col' = edge === 'top' || edge === 'bottom' ? 'row' : 'col';
    const inward = edge === 'top' || edge === 'left';

    const collected: Rgb[] = [];
    for (let step = 0; step < size && collected.length < band; step += 1) {
        const index = inward ? step : size - 1 - step;
        const line = segmentAverage(pixels, size, axis, index, lo, hi);
        // The letterbox test is a perceptual one, so it reads the sRGB value the
        // pixels actually carry rather than the linear accumulator.
        if (luma([toSrgb(line[0]), toSrgb(line[1]), toSrgb(line[2])]) >= LETTERBOX_LUMA) {
            collected.push(line);
        }
    }
    if (collected.length === 0) return [0, 0, 0];

    const sum = collected.reduce<Rgb>(
        (acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]],
        [0, 0, 0],
    );
    return [
        toSrgb(sum[0] / collected.length),
        toSrgb(sum[1] / collected.length),
        toSrgb(sum[2] / collected.length),
    ];
}

/** Averages a whole edge as one zone. */
export const averageEdge = (
    pixels: Uint8ClampedArray,
    size: number,
    edge: Edge,
    band: number = EDGE_BAND,
): Rgb => averageZone(pixels, size, edge, 0, size - 1, band);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Lightness window for the glow.
 *
 * The floor is deliberately low: a bias-light that refuses to go dark during a
 * night scene is the other half of what makes a fake Ambilight obvious. It is
 * not zero only so that a dim scene still reads as lit rather than switched off.
 */
const MIN_LIGHTNESS = 0.05;
const MAX_LIGHTNESS = 0.65;

/**
 * Pushes a sampled colour toward something worth casting on a wall.
 *
 * Averaging a frame pulls hard toward muddy grey, and a literal average makes a
 * glow that reads as dirt on the screen. Saturation is lifted and lightness is
 * held inside a window so blown highlights do not turn the surround into a lamp.
 */
export function vivid(rgb: Rgb): Rgb {
    const [r, g, b] = rgb.map((v) => clamp(v, 0, 255) / 255) as Rgb;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;

    // Grey has no hue to lift, but it still has to respect the lightness window:
    // a snow scene or a white flash would otherwise drive the surround to full
    // white, which is the exact blow-out the clamp exists to prevent.
    if (d === 0) {
        const flat = clamp(l, MIN_LIGHTNESS, MAX_LIGHTNESS) * 255;
        return [flat, flat, flat];
    }

    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;

    const s2 = clamp(s * 1.55 + 0.08, 0, 1);
    const l2 = clamp(l, MIN_LIGHTNESS, MAX_LIGHTNESS);

    const q = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2;
    const p = 2 * l2 - q;
    const channel = (t: number) => {
        let tt = t;
        if (tt < 0) tt += 1;
        if (tt > 1) tt -= 1;
        if (tt < 1 / 6) return p + (q - p) * 6 * tt;
        if (tt < 1 / 2) return q;
        if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
        return p;
    };
    return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255];
}

/** Reads every zone of every edge from a downscaled RGBA frame. */
export function sampleZones(
    pixels: Uint8ClampedArray,
    size: number = SAMPLE_SIZE,
    counts: Record<Edge, number> = ZONE_COUNTS,
    band: number = EDGE_BAND,
): AmbientZones {
    const edges: Edge[] = ['top', 'right', 'bottom', 'left'];
    const out = {} as AmbientZones;
    for (const edge of edges) {
        const n = Math.max(1, counts[edge]);
        out[edge] = Array.from({ length: n }, (_, i) => {
            const lo = Math.floor((i * size) / n);
            // Zones tile the edge exactly: the final one lands on size - 1
            // because (n * size) / n is size, whatever the counts are.
            const hi = Math.floor(((i + 1) * size) / n) - 1;
            return vivid(averageZone(pixels, size, edge, lo, Math.max(lo, hi), band));
        });
    }
    return out;
}

/** All zones black — the starting state, and what a torn-down player falls back to. */
export const blackZones = (counts: Record<Edge, number> = ZONE_COUNTS): AmbientZones => ({
    top: Array.from({ length: counts.top }, () => [0, 0, 0] as Rgb),
    right: Array.from({ length: counts.right }, () => [0, 0, 0] as Rgb),
    bottom: Array.from({ length: counts.bottom }, () => [0, 0, 0] as Rgb),
    left: Array.from({ length: counts.left }, () => [0, 0, 0] as Rgb),
});

export const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
];

/**
 * Eases every zone toward `to`.
 *
 * This exists because the obvious approach does not work: CSS cannot transition
 * between two `linear-gradient` backgrounds, so a glow driven purely by swapping
 * the style jumps at the sample rate instead of drifting. Interpolating here and
 * writing the result each frame is what makes the light move like light.
 */
export const lerpZones = (from: AmbientZones, to: AmbientZones, t: number): AmbientZones => {
    const edges: Edge[] = ['top', 'right', 'bottom', 'left'];
    const out = {} as AmbientZones;
    for (const edge of edges) {
        out[edge] = from[edge].map((c, i) => lerpRgb(c, to[edge][i] ?? c, t));
    }
    return out;
};

/**
 * Largest single-channel difference between two sets of zones.
 *
 * Used to decide whether a repaint is worth doing at all: once the light has
 * settled, rebuilding four gradient strings every frame is pure waste. A scan
 * of the numbers is cheap; hashing a few channels into a key is not equivalent,
 * because zones the key does not cover would freeze while the rest moved.
 */
export const maxZoneDelta = (a: AmbientZones, b: AmbientZones): number => {
    const edges: Edge[] = ['top', 'right', 'bottom', 'left'];
    let worst = 0;
    for (const edge of edges) {
        const za = a[edge];
        const zb = b[edge];
        if (za.length !== zb.length) return Infinity;
        for (let i = 0; i < za.length; i += 1) {
            for (let c = 0; c < 3; c += 1) {
                const d = Math.abs(za[i][c] - zb[i][c]);
                if (d > worst) worst = d;
            }
        }
    }
    return worst;
};

export const toCss = ([r, g, b]: Rgb, alpha = 1): string =>
    `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
