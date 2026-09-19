/**
 * The player's Web Audio processing graph: construction and routing, with no
 * React in the picture so the wiring can be exercised directly by tests.
 * The hook that binds it to the player lives in hooks/useAudioEnhancer.
 */

import { isTaintFreePipeline } from './mediaPipeline';

export type AudioEnhancerSettings = {
    /** Compress the dynamic range and lift presence so speech carries. */
    clarity: boolean;
    /** Simulated width via HRTF virtual speakers and early reflections. */
    widen: boolean;
    /**
     * How far the room opens up, 0..1. Drives the speaker angle and the level
     * of everything reflected, so one control covers "barely there" through to
     * "obviously a room" without exposing four knobs nobody wants to balance.
     */
    width: number;
    /**
     * Lip-sync compensation in milliseconds, 0 = off. Delays the whole audio
     * path; for setups where voices arrive before lips move (late 4K picture,
     * slow display chain) dialling this up re-aligns sound to picture. Only
     * positive values make sense — audio that lags cannot be pulled earlier.
     */
    lipSyncMs: number;
};

export const DEFAULT_AUDIO_ENHANCER: AudioEnhancerSettings = { clarity: false, widen: false, width: 0.5, lipSyncMs: 0 };

export const clampWidth = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);

/** Delay range the graph node is built for (createDelay max) and the UI offers. */
export const LIP_SYNC_MAX_MS = 1000;

export const clampLipSyncMs = (v: number): number => {
    if (!Number.isFinite(v)) return 0;
    return Math.min(LIP_SYNC_MAX_MS, Math.max(0, Math.round(v)));
};

/**
 * Web Audio may only tap the element when the pipeline is taint-free; see
 * isTaintFreePipeline for why, and what a tainted tap costs.
 */
export const canEnhanceAudio = (src: string, hlsSupported: boolean): boolean => {
    if (typeof window === 'undefined') return false;
    if (!('AudioContext' in window || 'webkitAudioContext' in window)) return false;
    return isTaintFreePipeline(src, hlsSupported);
};

/**
 * Speaker angle at width 0 and width 1. The low end stays near the standard
 * ±30° stereo triangle; the top end pushes past it without reaching the ±90°
 * that makes a mix sound like it has a hole in the middle.
 */
const SPEAKER_AZIMUTH_MIN = 22;
const SPEAKER_AZIMUTH_MAX = 48;

/**
 * Where the spatial processing starts.
 *
 * Below this, stereo carries almost no usable direction anyway, and running low
 * frequencies through HRTF filtering and delayed taps is what makes a naive
 * widener sound thin and phasey: the delays comb-filter the bass and the head
 * model rotates its phase. Everything under this crossover is summed to mono
 * and passed straight through, which is how the effect can widen the image
 * without hollowing out the low end.
 */
const CROSSOVER_HZ = 120;

/**
 * Damping applied to every reflection.
 *
 * This is the difference between a room and a noise. Real surfaces absorb
 * treble, so a bounce arrives duller than the sound that made it; passing
 * reflections through at full bandwidth is what makes the effect read as hiss
 * and clatter sitting on top of the film rather than as a space around it.
 * Each bounce is darker than the last, the way a second reflection has hit two
 * walls instead of one.
 */
const REFLECTION_DAMP_HZ = 6500;
const REFLECTION_DAMP_FALLOFF = 0.55;

/**
 * Early reflections — the part that turns two virtual speakers into a room.
 *
 * Direct sound alone localises but does not feel like anywhere. A handful of
 * delayed, attenuated, wider-panned copies is what the ear reads as walls.
 *
 * Levels are deliberately well under the direct sound. Reflections loud enough
 * to notice on their own stop sounding like a room and start sounding like a
 * second, blurred copy of the film.
 *
 * Every delay is a different prime-ish value on purpose: identical or
 * harmonically related delays on left and right comb-filter into a metallic
 * flange. The longer taps cross to the opposite side because a real side wall
 * reflects the far channel back across the listener.
 */
const REFLECTIONS: ReadonlyArray<{
    channel: 0 | 1;
    delayMs: number;
    gain: number;
    azimuthDeg: number;
    /** 1 = one wall, 2 = two; higher orders are damped further. */
    order: number;
}> = [
    { channel: 0, delayMs: 11, gain: 0.17, azimuthDeg: -72, order: 1 },
    { channel: 0, delayMs: 23, gain: 0.09, azimuthDeg: 58, order: 2 },
    { channel: 1, delayMs: 13, gain: 0.17, azimuthDeg: 72, order: 1 },
    { channel: 1, delayMs: 29, gain: 0.09, azimuthDeg: -58, order: 2 },
];

/** Seconds of tail. Long enough to feel like walls, short enough not to smear speech. */
const REVERB_SECONDS = 0.45;
/** Gap before the tail starts, so it reads as a room and not as an effect. */
const REVERB_PREDELAY_MS = 22;

export type Reflection = {
    delay: DelayNode;
    damp: BiquadFilterNode;
    gain: GainNode;
    panner: PannerNode;
    channel: 0 | 1;
    baseGain: number;
};

export type EnhancerGraph = {
    ctx: BaseAudioContext;
    source: AudioNode;
    /**
     * Head-of-chain lip-sync delay. Always wired source -> lipSync; the rest
     * of the routing starts at lipSync instead of source, so a 0ms setting is
     * a transparent passthrough and no rewire clicks when the value changes.
     */
    lipSync: DelayNode;
    presence: BiquadFilterNode;
    compressor: DynamicsCompressorNode;
    makeup: GainNode;
    /** Splits the crossover: lows bypass spatialisation entirely. */
    lowpass: BiquadFilterNode;
    highpass: BiquadFilterNode;
    /** Forces the low band to mono so the bass keeps its power. */
    bassMono: GainNode;
    splitter: ChannelSplitterNode;
    /** The ±30° virtual speakers carrying direct sound. */
    direct: [PannerNode, PannerNode];
    reflections: Reflection[];
    /** Sums the direct virtual speakers. */
    directBus: GainNode;
    /**
     * Permanent sum of the reflections. Separate from reflectBus because the
     * routing pass disconnects every bus it owns, and the tail's feed must not
     * be one of them: folded together, the reverb died the first time any
     * setting changed and never came back.
     */
    reflectSum: GainNode;
    /** Reflection level sent to the output; its gain is the width control. */
    reflectBus: GainNode;
    /** Short room tail, fed after the reflections. */
    preDelay: DelayNode;
    reverb: ConvolverNode;
    reverbBus: GainNode;
};

/** Presence lift in dB when clarity is on. */
const PRESENCE_GAIN_DB = 3;
/** Roughly what the compressor takes off dialogue-level material here. */
const MAKEUP_GAIN = 1.35;

/**
 * A short room tail built from decaying noise.
 *
 * Each channel gets its own random sequence: identical noise in both would
 * collapse the tail to a point in the middle of the head, which is the opposite
 * of what a tail is for. The exponent shapes the decay so most of the energy is
 * in the first tenth of a second, where a small room's is.
 */
const makeRoomImpulse = (ctx: BaseAudioContext, seconds = REVERB_SECONDS): AudioBuffer => {
    const rate = ctx.sampleRate || 48000;
    const length = Math.max(1, Math.floor(rate * seconds));
    const buffer = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < length; i += 1) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3.2;
        }
    }
    return buffer;
};

const placePanner = (p: PannerNode, azimuthDeg: number) => {
    const rad = (azimuthDeg * Math.PI) / 180;
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.positionX.value = Math.sin(rad);
    p.positionY.value = 0;
    // Negative Z is in front of the listener in Web Audio's coordinate system.
    p.positionZ.value = -Math.cos(rad);
};

/**
 * Builds every node once and wires the parts that never change. The source is
 * deliberately left unconnected: applyEnhancerSettings owns the routing, so
 * there is exactly one place that decides what is connected to what.
 */
export function createEnhancerGraph(ctx: BaseAudioContext, source: AudioNode): EnhancerGraph {
    // Head-of-chain lip-sync tap. Built at the 1s maximum the setting clamps
    // to; left unwired unless the viewer dials a delay, so tap behaviour for
    // every existing setting is untouched.
    const lipSync = ctx.createDelay(LIP_SYNC_MAX_MS / 1000);
    lipSync.delayTime.value = 0;

    // 2.5 kHz is where consonants live — the band that decides whether a line
    // is intelligible, not merely audible.
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 2500;
    presence.Q.value = 0.9;
    presence.gain.value = 0;

    // Night mode: pull the loud down toward the quiet. The slow release keeps
    // it from breathing audibly under sustained music.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -28;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.25;

    // Compression costs level; this puts it back, so toggling the effect is not
    // mistaken for a volume drop.
    const makeup = ctx.createGain();
    makeup.gain.value = 1;

    /* ------------------------------------------------------- crossover */

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = CROSSOVER_HZ;
    lowpass.Q.value = 0.707;

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = CROSSOVER_HZ;
    highpass.Q.value = 0.707;

    // Explicit single channel collapses the low band to mono before it reaches
    // the destination. Left as stereo it would keep whatever phase difference
    // the mix had down there, which the widening below would then smear.
    const bassMono = ctx.createGain();
    bassMono.channelCount = 1;
    bassMono.channelCountMode = 'explicit';
    bassMono.channelInterpretation = 'speakers';

    /* ---------------------------------------------------- spatial side */

    // A single PannerNode downmixes its input to mono before panning, which
    // collapses the stereo image instead of widening it. Each side therefore
    // needs its own virtual speaker, fed by an explicit split.
    const splitter = ctx.createChannelSplitter(2);
    const direct: [PannerNode, PannerNode] = [ctx.createPanner(), ctx.createPanner()];
    placePanner(direct[0], -SPEAKER_AZIMUTH_MIN);
    placePanner(direct[1], SPEAKER_AZIMUTH_MIN);

    const directBus = ctx.createGain();
    const reflectSum = ctx.createGain();
    const reflectBus = ctx.createGain();
    const reverbBus = ctx.createGain();

    const reflections: Reflection[] = REFLECTIONS.map((spec) => {
        const delay = ctx.createDelay(0.1);
        delay.delayTime.value = spec.delayMs / 1000;
        // Later bounces have hit more surfaces, so they lose more treble.
        const damp = ctx.createBiquadFilter();
        damp.type = 'lowpass';
        damp.frequency.value = REFLECTION_DAMP_HZ * REFLECTION_DAMP_FALLOFF ** (spec.order - 1);
        damp.Q.value = 0.707;
        const gain = ctx.createGain();
        gain.gain.value = spec.gain;
        const panner = ctx.createPanner();
        placePanner(panner, spec.azimuthDeg);
        // Reflections tap the dry channel, not the direct panner's output: a
        // reflection is the source bouncing off a wall, not the virtual speaker
        // bouncing, so it must be spatialised once at its own angle.
        splitter.connect(delay, spec.channel);
        delay.connect(damp);
        damp.connect(gain);
        gain.connect(panner);
        panner.connect(reflectSum);
        return { delay, damp, gain, panner, channel: spec.channel, baseGain: spec.gain };
    });

    // The tail follows the reflections, never the direct sound: feeding it dry
    // puts reverb on dialogue with no gap, which is what smears speech.
    const preDelay = ctx.createDelay(0.2);
    preDelay.delayTime.value = REVERB_PREDELAY_MS / 1000;
    const reverb = ctx.createConvolver();
    reverb.normalize = true;
    reverb.buffer = makeRoomImpulse(ctx);
    reflectSum.connect(reflectBus);
    reflectSum.connect(preDelay);
    preDelay.connect(reverb);
    reverb.connect(reverbBus);

    splitter.connect(direct[0], 0);
    splitter.connect(direct[1], 1);
    direct[0].connect(directBus);
    direct[1].connect(directBus);

    return {
        ctx, source, lipSync, presence, compressor, makeup,
        lowpass, highpass, bassMono, splitter, direct, reflections,
        directBus, reflectSum, reflectBus, preDelay, reverb, reverbBus,
    };
}

/**
 * Routes the graph for `settings`. Only the source and the tail are torn down,
 * so the inner chain survives a toggle and the switch does not click.
 *
 * With nothing enabled this still runs, and connects the source straight to the
 * destination — once the element is tapped, bypass has to be an explicit wire
 * rather than the absence of one, or the audio simply stops.
 */
export function applyEnhancerSettings(graph: EnhancerGraph, settings: AudioEnhancerSettings): void {
    const {
        ctx, source, lipSync, presence, compressor, makeup,
        lowpass, highpass, bassMono, splitter, direct,
        directBus, reflectBus, reverbBus,
    } = graph;

    source.disconnect();
    lipSync.disconnect();
    presence.disconnect();
    compressor.disconnect();
    makeup.disconnect();
    lowpass.disconnect();
    highpass.disconnect();
    bassMono.disconnect();
    directBus.disconnect();
    reflectBus.disconnect();
    reverbBus.disconnect();

    presence.gain.setTargetAtTime(settings.clarity ? PRESENCE_GAIN_DB : 0, ctx.currentTime, 0.05);
    makeup.gain.setTargetAtTime(settings.clarity ? MAKEUP_GAIN : 1, ctx.currentTime, 0.05);

    // One control, three consequences: how far apart the speakers sit, how much
    // of the room comes back, and how much tail sits behind it. Wet levels stay
    // low even at the top of the range — past this the film starts sounding
    // like it is playing in the next room.
    const width = clampWidth(settings.width);
    const azimuth = SPEAKER_AZIMUTH_MIN + (SPEAKER_AZIMUTH_MAX - SPEAKER_AZIMUTH_MIN) * width;
    placePanner(direct[0], -azimuth);
    placePanner(direct[1], azimuth);
    reflectBus.gain.setTargetAtTime(0.85 * width, ctx.currentTime, 0.08);
    reverbBus.gain.setTargetAtTime(0.22 * width, ctx.currentTime, 0.08);

    // Lip-sync first: the whole downstream chain (dry or widened) inherits
    // the shift, and setTargetAtTime glides value changes instead of clicking.
    // At 0 the tap stays out of the path entirely (see createEnhancerGraph).
    const lipMs = clampLipSyncMs(settings.lipSyncMs);
    lipSync.delayTime.setTargetAtTime(lipMs / 1000, ctx.currentTime, 0.05);
    // source -> [lipSync]? -> [presence -> compressor -> makeup]? -> [crossover -> widen]? -> out
    let head: AudioNode = source;
    if (lipMs > 0) {
        head.connect(lipSync);
        head = lipSync;
    }
    if (settings.clarity) {
        head.connect(presence);
        presence.connect(compressor);
        compressor.connect(makeup);
        head = makeup;
    }
    if (settings.widen) {
        // Lows skip the spatial side entirely and arrive mono; only the band
        // that carries direction is widened.
        head.connect(lowpass);
        lowpass.connect(bassMono);
        bassMono.connect(ctx.destination);

        head.connect(highpass);
        highpass.connect(splitter);
        directBus.connect(ctx.destination);
        reflectBus.connect(ctx.destination);
        reverbBus.connect(ctx.destination);
    } else {
        head.connect(ctx.destination);
    }
}
