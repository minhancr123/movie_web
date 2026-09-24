'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import SpatialShader from '@/components/SpatialShader';
import {
    sampleZones, lerpZones, blackZones, toCss, maxZoneDelta,
    SAMPLE_SIZE, type AmbientZones, type Rgb,
} from '@/lib/ambilight';

export type CinemaMode = 'off' | 'dim' | 'ambilight';

/**
 * Elements carrying this attribute keep their own light while the room is
 * dimmed. The settings panel floats outside the player frame, so without it the
 * one thing a viewer opens mid-film is the one thing they cannot read.
 */
export const CINEMA_BRIGHT_ATTR = 'data-cinema-bright';

/** Ten samples a second; the glow is a wash, not a strobe. */
const SAMPLE_INTERVAL_MS = 100;
/**
 * Smoothing time constant. Light from a screen does not snap between colours,
 * and at ~120 ms a hard cut still lands quickly while a busy scene stops
 * flickering. Applied per frame as 1 - e^(-dt/tau), so it behaves the same
 * whether the display runs at 60 Hz or 120 Hz.
 */
const SMOOTH_TAU_MS = 120;
/** Never let a struggling device sample slower than this. */
const MAX_SAMPLE_INTERVAL_MS = 1000;
/**
 * Share of wall time sampling may consume. The interval is held at roughly
 * 20x the measured cost of one sample, so an expensive source spaces itself
 * out instead of competing with video decode.
 */
const SAMPLE_DUTY = 20;

/**
 * Backing-store size of the glow canvas.
 *
 * It is stretched across the whole surround, so the compositor magnifies it
 * heavily and that bilinear upscale is what softens the light. A CSS
 * `filter: blur()` wide enough to look like a glow would have to re-rasterise
 * its whole layer whenever the pixels beneath change, which at frame rate over
 * a surface this size starves video decode.
 */
const GLOW_W = 96;
const GLOW_H = 54;
/**
 * Glow repaints per second. A diffuse wash does not need frame rate, and every
 * repaint competes with decode, so it is capped well below the animation loop.
 */
const PAINT_INTERVAL_MS = 33;
/** How far the glow reaches past the player, in rem, split evenly per side. */
const SPREAD_REM = 18;
/**
 * Fades the wash to transparent before the canvas edge.
 *
 * The canvas is a rectangle; without this the light stops in a straight line
 * and reads as a box on the wall. An elliptical mask makes the falloff organic
 * — full strength around the bezel, gone well inside the border — which is the
 * whole difference between a TV backlight photo and an LED strip outline.
 */
const EDGE_FADE_MASK =
    'radial-gradient(ellipse at 50% 50%, rgba(0,0,0,1) 22%, rgba(0,0,0,0) 85%)';
/**
 * Peak alpha of one light blob. They are composited additively, so overlapping
 * neighbours build up; this leaves headroom for four or five to sum without
 * clipping to white.
 */
const BLOB_ALPHA = 0.65;

type Props = {
    mode: CinemaMode;
    /** The playing element. Null until the player has mounted one. */
    video: HTMLVideoElement | null;
};

const rootFontPx = () => {
    if (typeof window === 'undefined') return 16;
    const v = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(v) && v > 0 ? v : 16;
};

/**
 * The room around the player: either a dimmed surround, or an Ambilight-style
 * glow sampled from the picture.
 *
 * It renders here rather than inside the player because the player's own frame
 * is rounded and `overflow-hidden`; light emitted inside it would be clipped at
 * the bezel instead of spilling onto the page.
 */
export default function CinemaLayer({ mode, video }: Props) {
    const glowRef = useRef<HTMLCanvasElement>(null);
    const dimRef = useRef<HTMLDivElement>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);

    /* ------------------------------------------------------------ glow */

    useEffect(() => {
        if (mode !== 'ambilight' || !video) return;

        const glow = glowRef.current;
        const glowCtx = glow?.getContext('2d') ?? null;
        if (!glow || !glowCtx) return;

        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        // Safe here only because everything drawn into this canvas is already
        // 16x16: willReadFrequently forces a software surface, which makes
        // getImageData free but any drawImage cost proportional to the SOURCE.
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        let raf = 0;
        let stopped = false;
        let sampling = false;
        let canResize = true;
        let lastSample = 0;
        let lastFrame = 0;
        let lastPaint = 0;
        let cost = 0;
        let interval = SAMPLE_INTERVAL_MS;
        let current = blackZones();
        let target = blackZones();
        let painted = blackZones();
        let everPainted = false;

        /**
         * Paints the surround as overlapping pools of light rather than bands.
         *
         * Filling rectangles along each edge is what made this read as an LED
         * strip taped behind a television: straight edges and visible corners.
         * A radial falloff per zone has no edge to see, and neighbours blend
         * into each other, which is how light actually leaves a panel.
         */
        const paint = (zones: AmbientZones, now: number) => {
            // Settled, or too soon since the last one. Sub-half-a-level moves
            // are below what an 8-bit channel could even express.
            if (everPainted && maxZoneDelta(zones, painted) < 0.5) return;
            if (everPainted && now - lastPaint < PAINT_INTERVAL_MS) return;
            lastPaint = now;
            painted = zones;
            everPainted = true;

            // Where the player's own edges fall inside this canvas: the canvas
            // overhangs it by SPREAD_REM/2 on every side.
            const spreadPx = (SPREAD_REM / 2) * rootFontPx();
            const gx = Math.max(1, (spreadPx / Math.max(1, glow.clientWidth)) * GLOW_W);
            const gy = Math.max(1, (spreadPx / Math.max(1, glow.clientHeight)) * GLOW_H);
            const left = gx;
            const right = GLOW_W - gx;
            const top = gy;
            const bottom = GLOW_H - gy;
            const radius = Math.max(gx, gy) * 3.4;
            /**
             * Pushes each blob centre outward, off the bezel, by this share of
             * the overhang.
             *
             * Centres sitting exactly on the player edges put the brightness
             * peak on the bezel line itself (the inner half hides behind the
             * opaque player), which reads as a lit picture frame. Peaks floating
             * outside the frame dissolve the rectangle into a spill of light.
             */
            const OUT = 0.7;

            glowCtx.clearRect(0, 0, GLOW_W, GLOW_H);
            // Light adds; it does not paint over. Corners lit from two edges
            // should brighten, not have the later edge replace the earlier one.
            glowCtx.globalCompositeOperation = 'lighter';

            const blob = (cx: number, cy: number, colour: Rgb) => {
                const g = glowCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
                g.addColorStop(0, toCss(colour, BLOB_ALPHA));
                g.addColorStop(0.4, toCss(colour, BLOB_ALPHA * 0.5));
                g.addColorStop(1, toCss(colour, 0));
                glowCtx.fillStyle = g;
                glowCtx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
            };

            const along = (n: number, i: number, a: number, b: number) => a + ((i + 0.5) / n) * (b - a);
            zones.top.forEach((c, i) => blob(along(zones.top.length, i, left, right), top - gy * OUT, c));
            zones.bottom.forEach((c, i) => blob(along(zones.bottom.length, i, left, right), bottom + gy * OUT, c));
            zones.left.forEach((c, i) => blob(left - gx * OUT, along(zones.left.length, i, top, bottom), c));
            zones.right.forEach((c, i) => blob(right + gx * OUT, along(zones.right.length, i, top, bottom), c));

            glowCtx.globalCompositeOperation = 'source-over';
        };

        /**
         * Downscales through createImageBitmap rather than drawImage.
         *
         * The resize happens inside the browser's imaging pipeline, off the main
         * thread where it is available, so a 4K frame never has to be scaled by
         * hand on the thread that is also decoding video. Only the resulting
         * 16x16 bitmap is ever drawn to the canvas.
         */
        const readFrame = async () => {
            if (sampling || stopped) return;
            sampling = true;
            const started = performance.now();
            try {
                if (canResize) {
                    const bmp = await createImageBitmap(video, {
                        resizeWidth: SAMPLE_SIZE,
                        resizeHeight: SAMPLE_SIZE,
                        resizeQuality: 'low',
                    });
                    // Some engines accept the options and ignore them; if the
                    // bitmap came back full size, stop paying for the round trip.
                    if (bmp.width !== SAMPLE_SIZE) canResize = false;
                    try {
                        ctx.drawImage(bmp, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
                    } finally {
                        // Bitmaps hold GPU memory until closed; a throw between
                        // here and the next sample would leak one per frame.
                        bmp.close();
                    }
                } else {
                    ctx.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
                }
                if (stopped) return;
                target = sampleZones(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
            } catch (err) {
                // A tainted element can only ever fail; back off permanently.
                // Anything else (a frame not ready yet) is worth retrying.
                if ((err as DOMException)?.name === 'SecurityError') {
                    stopped = true;
                    cancelAnimationFrame(raf);
                    target = blackZones();
                    current = blackZones();
                    everPainted = false;
                    paint(current, performance.now());
                }
            } finally {
                sampling = false;
                const spent = performance.now() - started;
                cost = cost ? cost * 0.8 + spent * 0.2 : spent;
                interval = Math.min(
                    MAX_SAMPLE_INTERVAL_MS,
                    Math.max(SAMPLE_INTERVAL_MS, cost * SAMPLE_DUTY),
                );
            }
        };

        const loop = (now: number) => {
            if (stopped) return;
            raf = requestAnimationFrame(loop);

            const dt = lastFrame ? now - lastFrame : 16;
            lastFrame = now;

            const playing = !video.paused && !video.ended && video.readyState >= 2 && !document.hidden;
            if (playing && now - lastSample >= interval) {
                lastSample = now;
                void readFrame();
            }
            // Paused or hidden, the light eases to rest instead of freezing on
            // whatever frame happened to be showing.
            if (!playing) target = blackZones();

            current = lerpZones(current, target, 1 - Math.exp(-dt / SMOOTH_TAU_MS));
            paint(current, now);
        };

        raf = requestAnimationFrame(loop);
        return () => {
            stopped = true;
            cancelAnimationFrame(raf);
        };
    }, [mode, video]);

    /* ------------------------------------------------------------- dim */

    /**
     * Cuts the player — and anything marked bright — out of the dim sheet.
     *
     * Masking the whole overlay, rather than laying a scrim underneath it, is
     * what keeps the picture untouched: an earlier version painted the shader
     * across the full viewport, which put a moving wash on top of the very video
     * it was meant to frame. Holes have to be cut from the shader too, not only
     * from the darkness.
     */
    useEffect(() => {
        if (mode !== 'dim' || !video) return;

        let raf = 0;
        let signature = '';

        const apply = () => {
            raf = requestAnimationFrame(apply);
            const el = dimRef.current;
            if (!el) return;

            const rects: DOMRect[] = [video.getBoundingClientRect()];
            for (const bright of Array.from(document.querySelectorAll(`[${CINEMA_BRIGHT_ATTR}]`))) {
                const r = bright.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) rects.push(r);
            }

            const next = rects.map((r) => `${r.left | 0},${r.top | 0},${r.width | 0},${r.height | 0}`).join(';');
            if (next === signature) return;
            signature = next;

            // Holes first, the full sheet last. `subtract` then removes each
            // hole from everything beneath it, which — unlike `exclude` — still
            // behaves when two holes overlap, as the settings panel and the
            // player do. Only the standard property is set: Chromium aliases
            // -webkit-mask-composite onto it, so writing the webkit keywords
            // afterwards silently replaced valid values with invalid ones and
            // no hole was cut at all.
            const layer = 'linear-gradient(#000,#000)';
            const image = [...rects.map(() => layer), layer].join(',');
            const size = [...rects.map((r) => `${Math.round(r.width)}px ${Math.round(r.height)}px`), '100% 100%'].join(', ');
            const position = [...rects.map((r) => `${Math.round(r.left)}px ${Math.round(r.top)}px`), '0 0'].join(', ');
            const composite = [...rects.map(() => 'subtract'), 'add'].join(', ');

            const s = el.style as CSSStyleDeclaration & Record<string, string>;
            s.maskImage = image;
            s.maskSize = size;
            s.maskPosition = position;
            s.maskRepeat = 'no-repeat';
            s.maskComposite = composite;
        };

        raf = requestAnimationFrame(apply);
        return () => cancelAnimationFrame(raf);
    }, [mode, video]);

    if (mode === 'off') return null;

    if (mode === 'dim') {
        if (!mounted) return null;
        /*
         * Portalled to the body on purpose. The watch page wraps its content in
         * a `relative z-10` element, which opens a stacking context: anything
         * rendered inside it — at any z-index — stays behind the fixed header,
         * so a scrim placed there would dim the page but leave the chrome lit.
         */
        return createPortal(
            <div aria-hidden ref={dimRef} className="pointer-events-none fixed inset-0 z-[55]">
                <div className="absolute inset-0 bg-black/85" />
                {/* Sits above the darkness so the room has moving light in it,
                    and is masked along with it so none of it reaches the film. */}
                <div className="absolute inset-0 opacity-30">
                    <SpatialShader opacity={1} speed={0.5} interactive={false} />
                </div>
            </div>,
            document.body,
        );
    }

    // One small canvas stretched over the surround. The browser's own upscaling
    // is what softens it, so there is no filter to re-rasterise per frame.
    // The elliptical mask (EDGE_FADE_MASK) kills the canvas rectangle: light
    // must dissolve into the dark, never stop at a border.
    return (
        // Inline: the wash spills behind the player. Fullscreen: this viewport
        // masks the same canvas to an inward edge glow above the full-size film.
        <div aria-hidden className="cinema-glow-viewport pointer-events-none absolute inset-0 -z-10">
            <canvas
                ref={glowRef}
                width={GLOW_W}
                height={GLOW_H}
                className="pointer-events-none absolute"
                style={{
                    top: `-${SPREAD_REM / 2}rem`,
                    left: `-${SPREAD_REM / 2}rem`,
                    width: `calc(100% + ${SPREAD_REM}rem)`,
                    height: `calc(100% + ${SPREAD_REM}rem)`,
                    maskImage: `var(--cinema-glow-canvas-mask, ${EDGE_FADE_MASK})`,
                    WebkitMaskImage: `var(--cinema-glow-canvas-mask, ${EDGE_FADE_MASK})`,
                }}
            />
        </div>
    );
}
