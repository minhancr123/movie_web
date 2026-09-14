/**
 * Routing tests for the player's Web Audio chain.
 *
 * These matter more than the filter values: a wrong coefficient sounds off, but
 * a wrong wire produces silence, and the two failures are indistinguishable to
 * someone watching a film. The two traps guarded here are (a) losing the bypass
 * wire once the element is tapped, and (b) widening through a single PannerNode,
 * which downmixes to mono and narrows the image it was asked to widen.
 *
 * The graph module is TypeScript, so it is compiled with the project's own tsc
 * into a temp dir and exercised there — no test framework or new dependency.
 * It deliberately imports no React, which is what lets it run under plain node.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const outDir = mkdtempSync(path.join(tmpdir(), 'audio-fx-'));

// Invoked through node rather than the npx shim: spawning a .cmd fails with
// EINVAL on Windows, and this needs no shell resolution anyway.
execFileSync(
    process.execPath,
    [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), 'src/lib/audioEnhancerGraph.ts',
        '--outDir', outDir, '--module', 'commonjs', '--target', 'es2020',
        '--moduleResolution', 'node', '--skipLibCheck', '--jsx', 'preserve'],
    { cwd: root, stdio: 'pipe' },
);

const mod = await import(pathToFileURL(path.join(outDir, 'audioEnhancerGraph.js')).href);
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }));

/* ------------------------------------------------------------ mock graph */

const makeCtx = () => {
    const edges = [];
    const node = (kind) => {
        const self = {
            kind,
            connect: (dest, output) => { edges.push({ from: self, to: dest, output }); },
            disconnect: () => {
                for (let i = edges.length - 1; i >= 0; i -= 1) {
                    if (edges[i].from === self) edges.splice(i, 1);
                }
            },
        };
        return self;
    };
    const param = () => ({ value: 0, setTargetAtTime(v) { this.value = v; } });
    const ctx = {
        currentTime: 0,
        state: 'running',
        destination: node('destination'),
        edges,
        createBiquadFilter: () => Object.assign(node('biquad'), { type: '', frequency: param(), Q: param(), gain: param() }),
        createDynamicsCompressor: () => Object.assign(node('compressor'), {
            threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
        }),
        createGain: () => Object.assign(node('gain'), { gain: param() }),
        createChannelSplitter: () => node('splitter'),
        createDelay: () => Object.assign(node('delay'), { delayTime: param() }),
        createConvolver: () => Object.assign(node('convolver'), { normalize: true, buffer: null }),
        sampleRate: 48000,
        createBuffer: (channels, length) => ({
            length,
            getChannelData: () => new Float32Array(length),
        }),
        createPanner: () => Object.assign(node('panner'), {
            panningModel: '', distanceModel: '', positionX: param(), positionY: param(), positionZ: param(),
        }),
    };
    return { ctx, source: node('source'), edges };
};

/** Does a signal path exist from `from` to `to`, following connections? */
const reaches = (edges, from, to, seen = new Set()) => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return edges.some((e) => e.from === from && reaches(edges, e.to, to, seen));
};

const setup = () => {
    const { ctx, source, edges } = makeCtx();
    return { ctx, source, edges, graph: mod.createEnhancerGraph(ctx, source) };
};

/* ----------------------------------------------------------------- tests */

test('audio always reaches the destination, in every combination', () => {
    // Once the element is tapped, an unrouted graph is silence, not a bypass.
    for (const clarity of [false, true]) {
        for (const widen of [false, true]) {
            const { ctx, source, edges, graph } = setup();
            mod.applyEnhancerSettings(graph, { clarity, widen, width: 0.5 });
            assert.ok(
                reaches(edges, source, ctx.destination),
                `clarity=${clarity} widen=${widen} must still reach the destination`,
            );
        }
    }
});

test('off means untouched: no filter or panner in the path', () => {
    const { ctx, source, edges, graph } = setup();
    mod.applyEnhancerSettings(graph, { clarity: false, widen: false, width: 0.5 });
    assert.deepEqual(
        edges.filter((e) => e.from === source).map((e) => e.to.kind),
        ['destination'],
        'with nothing enabled the source must go straight out',
    );
    assert.equal(graph.presence.gain.value, 0, 'presence must be flat when clarity is off');
    assert.equal(graph.makeup.gain.value, 1, 'no makeup gain when nothing is compressed');
});

test('clarity routes through presence then compressor then makeup', () => {
    const { source, edges, graph } = setup();
    mod.applyEnhancerSettings(graph, { clarity: true, widen: false, width: 0.5 });
    assert.ok(reaches(edges, source, graph.presence));
    assert.ok(reaches(edges, graph.presence, graph.compressor));
    assert.ok(reaches(edges, graph.compressor, graph.makeup));
    assert.ok(graph.presence.gain.value > 0, 'presence must actually be lifted');
    assert.ok(graph.makeup.gain.value > 1, 'compression must be compensated');
});

test('widening drives two panners from separate channels, never one', () => {
    const { ctx, edges, graph } = setup();
    mod.applyEnhancerSettings(graph, { clarity: false, widen: true, width: 0.5 });

    // The whole point: one PannerNode would downmix to mono and collapse the
    // image. Left and right must come off different splitter outputs.
    const directFeeds = edges.filter((e) => e.from === graph.splitter && graph.direct.includes(e.to));
    assert.equal(directFeeds.length, 2, 'both sides must be split out');
    assert.deepEqual(directFeeds.map((e) => e.output).sort(), [0, 1], 'one speaker per channel');
    assert.notEqual(graph.direct[0], graph.direct[1]);

    for (const p of graph.direct) {
        assert.equal(p.panningModel, 'HRTF');
        assert.ok(reaches(edges, p, ctx.destination), 'each virtual speaker must be audible');
    }
    // Mirrored across the centre line, and in front of the listener (-Z).
    assert.ok(graph.direct[0].positionX.value < 0 && graph.direct[1].positionX.value > 0);
    assert.equal(graph.direct[0].positionX.value, -graph.direct[1].positionX.value);
    assert.ok(graph.direct[0].positionZ.value < 0, 'speakers belong in front, not behind');
});

test('bass bypasses spatialisation and arrives mono', () => {
    // Running lows through delays and a head model is what makes a naive
    // widener sound thin: the taps comb-filter the bass and HRTF rotates its
    // phase. The low band has to reach the output without touching either.
    const { ctx, source, edges, graph } = setup();
    mod.applyEnhancerSettings(graph, { clarity: false, widen: true, width: 0.5 });

    assert.ok(reaches(edges, source, graph.lowpass), 'lows must be split off');
    // Parallel, never in series: feeding the lowpass from the highpass makes a
    // band-pass that passes almost nothing, and the bass silently disappears
    // while every "does it reach" check still reads as true.
    assert.ok(!reaches(edges, graph.highpass, graph.lowpass), 'crossover halves must not chain');
    assert.ok(!reaches(edges, graph.lowpass, graph.highpass), 'crossover halves must not chain');
    assert.ok(reaches(edges, graph.lowpass, graph.bassMono));
    assert.ok(reaches(edges, graph.bassMono, ctx.destination));
    assert.ok(!reaches(edges, graph.lowpass, graph.splitter), 'lows must never reach the spatial side');
    for (const r of graph.reflections) {
        assert.ok(!reaches(edges, graph.lowpass, r.delay), 'lows must never reach a delay tap');
    }

    assert.equal(graph.bassMono.channelCount, 1, 'low band must be forced to a single channel');
    assert.equal(graph.bassMono.channelCountMode, 'explicit', 'or the count is only a hint');
    assert.equal(graph.lowpass.frequency.value, graph.highpass.frequency.value,
        'the two halves of the crossover must meet at the same frequency');
});

test('early reflections are delayed, attenuated and wider than the speakers', () => {
    const { ctx, edges, graph } = setup();
    mod.applyEnhancerSettings(graph, { clarity: false, widen: true, width: 0.5 });
    assert.ok(graph.reflections.length >= 4, 'a room needs more than one bounce');

    const speakerX = Math.abs(graph.direct[1].positionX.value);
    for (const r of graph.reflections) {
        assert.ok(r.delay.delayTime.value > 0, 'a reflection with no delay is just more direct sound');
        assert.ok(r.gain.gain.value > 0 && r.gain.gain.value < 1, 'a reflection is quieter than its source');
        assert.equal(r.panner.panningModel, 'HRTF');
        assert.ok(Math.abs(r.panner.positionX.value) > speakerX,
            'reflections must sit wider than the direct speakers, or they add no room');
        assert.ok(reaches(edges, graph.splitter, r.delay), 'reflections tap the dry channel');
        assert.ok(reaches(edges, r.panner, ctx.destination));
    }
});

test('no two delay taps share a length', () => {
    // Equal or harmonically related delays on the two sides comb-filter into a
    // metallic flange, which is the single most obvious way this can sound fake.
    const { graph } = setup();
    const lengths = graph.reflections.map((r) => r.delay.delayTime.value);
    assert.equal(new Set(lengths).size, lengths.length, `delays must all differ: ${lengths}`);
});

test('reflections cross to the far side as well as the near one', () => {
    // A side wall sends the opposite channel back across the listener; taps
    // that only ever stay on their own side read as two separate speakers.
    const { graph } = setup();
    for (const channel of [0, 1]) {
        const own = graph.reflections.filter((r) => r.channel === channel);
        assert.ok(own.length >= 2, 'each channel needs a near and a far bounce');
        const sides = new Set(own.map((r) => Math.sign(r.panner.positionX.value)));
        assert.equal(sides.size, 2, `channel ${channel} must bounce to both sides`);
    }
});

test('clarity and widening compose in the right order', () => {
    const { ctx, source, edges, graph } = setup();
    mod.applyEnhancerSettings(graph, { clarity: true, widen: true, width: 0.5 });
    // Dynamics before spatialisation: compressing the panned output would pump
    // the image around as the level moves.
    assert.ok(reaches(edges, source, graph.makeup));
    assert.ok(reaches(edges, graph.makeup, graph.highpass));
    assert.ok(reaches(edges, graph.highpass, graph.splitter));
    assert.ok(reaches(edges, graph.splitter, ctx.destination));
    assert.ok(!edges.some((e) => e.from === source && e.to === ctx.destination), 'no dry path may bypass the chain');
});

test('toggling rewires cleanly instead of stacking duplicate paths', () => {
    const { ctx, source, edges, graph } = setup();
    const combos = [
        { clarity: true, widen: false, width: 0.5 }, { clarity: true, widen: true, width: 0.5 },
        { clarity: false, widen: true, width: 0.5 }, { clarity: false, widen: false, width: 0.5 },
        { clarity: true, widen: true, width: 0.5 },
    ];
    for (const c of combos) mod.applyEnhancerSettings(graph, c);

    // A duplicate edge means a doubled signal, which reads as distortion.
    const seen = new Set();
    for (const e of edges) {
        const key = `${e.from.kind}:${edges.indexOf(e)}`;
        assert.ok(!seen.has(key), 'no duplicate connections after repeated toggling');
        seen.add(key);
    }
    assert.equal(edges.filter((e) => e.from === source).length, 1, 'source must have exactly one outgoing wire');
    assert.ok(reaches(edges, source, ctx.destination), 'still audible after repeated toggling');
});

test('the cross-origin gate refuses anything but the MSE path', () => {
    globalThis.window = { AudioContext: function () { } };
    try {
        const hls = 'https://cdn.example/api/playback/hls/abc/index.m3u8';
        assert.equal(mod.canEnhanceAudio(hls, true), true, 'remux via MSE is the safe case');
        // Native HLS: the element fetches the playlist itself, so it can taint.
        assert.equal(mod.canEnhanceAudio(hls, false), false, 'no MSE means no tap');
        // Direct upstream play: cross-origin, and the element sets no crossOrigin.
        assert.equal(mod.canEnhanceAudio('https://torbox.example/file.mp4', true), false);
        assert.equal(mod.canEnhanceAudio('https://torbox.example/file.mkv?x=.m3u8.mp4', true), false);
        // Query and fragment must not hide the real extension either way.
        assert.equal(mod.canEnhanceAudio(`${hls}?token=1`, true), true);
    } finally {
        delete globalThis.window;
    }
});

test('every reflection is damped, and later bounces more than early ones', () => {
    // Undamped bounces are the difference between a room and a hiss: real
    // surfaces absorb treble, so a reflection has to arrive duller than what
    // made it, and a second-order bounce duller still.
    const { graph } = setup();
    for (const r of graph.reflections) {
        assert.equal(r.damp.type, 'lowpass', 'a reflection must lose treble somewhere');
        assert.ok(r.damp.frequency.value > 0 && r.damp.frequency.value < 20000);
        assert.ok(reaches(graph.ctx.edges, r.delay, r.damp), 'damping must sit in the tap');
        assert.ok(reaches(graph.ctx.edges, r.damp, r.panner));
    }
    const first = graph.reflections.filter((r) => r.delay.delayTime.value < 0.02);
    const later = graph.reflections.filter((r) => r.delay.delayTime.value >= 0.02);
    assert.ok(first.length && later.length);
    assert.ok(Math.max(...later.map((r) => r.damp.frequency.value))
        < Math.min(...first.map((r) => r.damp.frequency.value)),
        'the longer path must come back darker');
});

test('the tail is fed from the reflections, never from the dry signal', () => {
    // Reverb hung straight on the direct sound lands with no gap and smears
    // speech; following the reflections gives it the delay a room has.
    const { ctx, source, graph } = setup();
    mod.applyEnhancerSettings(graph, { clarity: false, widen: true, width: 0.5 });
    assert.ok(reaches(ctx.edges, graph.reflectSum, graph.preDelay));
    assert.ok(reaches(ctx.edges, graph.preDelay, graph.reverb));
    assert.ok(reaches(ctx.edges, graph.reverb, graph.reverbBus));
    assert.ok(graph.preDelay.delayTime.value > 0, 'the tail needs a pre-delay');
    assert.ok(!reaches(ctx.edges, graph.directBus, graph.reverb), 'direct sound must stay dry');
    assert.ok(graph.reverb.buffer, 'the convolver needs an impulse');

    // The failure this test was written for: the routing pass tears down the
    // buses it owns, and the tail's feed must survive that.
    mod.applyEnhancerSettings(graph, { clarity: true, widen: true, width: 0.8 });
    mod.applyEnhancerSettings(graph, { clarity: false, widen: true, width: 0.3 });
    assert.ok(reaches(ctx.edges, graph.reflectSum, graph.reverb), 'tail must survive re-routing');
    assert.ok(reaches(ctx.edges, graph.reverb, ctx.destination), 'and still be audible');
});

test('width scales the room and stays under the direct sound', () => {
    const read = (w) => {
        const { graph } = setup();
        mod.applyEnhancerSettings(graph, { clarity: false, widen: true, width: w });
        return {
            azimuth: Math.abs(graph.direct[1].positionX.value),
            wet: graph.reflectBus.gain.value,
            tail: graph.reverbBus.gain.value,
        };
    };
    const lo = read(0);
    const mid = read(0.5);
    const hi = read(1);

    assert.ok(lo.azimuth < mid.azimuth && mid.azimuth < hi.azimuth, 'wider must mean wider');
    assert.ok(lo.wet < mid.wet && mid.wet < hi.wet, 'wider must bring back more room');
    assert.ok(lo.tail < mid.tail && mid.tail < hi.tail);
    assert.equal(lo.wet, 0, 'width 0 must be the dry image, not a quiet room');
    assert.ok(hi.wet < 1 && hi.tail < hi.wet, 'even at maximum the room stays behind the film');

    // Rubbish in must not produce a silent or deafening room.
    const bad = read(NaN);
    assert.ok(bad.wet > 0 && bad.wet < 1, 'a bad width must fall back, not break');
});
