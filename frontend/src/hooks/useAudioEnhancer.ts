'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
    canEnhanceAudio, createEnhancerGraph, applyEnhancerSettings,
    type AudioEnhancerSettings, type EnhancerGraph,
} from '@/lib/audioEnhancerGraph';

export {
    DEFAULT_AUDIO_ENHANCER, canEnhanceAudio,
    type AudioEnhancerSettings,
} from '@/lib/audioEnhancerGraph';

export function useAudioEnhancer(
    videoRef: RefObject<HTMLVideoElement>,
    src: string,
    hlsSupported: boolean,
    settings: AudioEnhancerSettings,
) {
    const graphRef = useRef<EnhancerGraph | null>(null);
    const [failed, setFailed] = useState(false);
    const supported = canEnhanceAudio(src, hlsSupported);
    const active = supported && !failed && (settings.clarity || settings.widen);

    /**
     * Built on first use, never before: tapping the element is irreversible, so
     * a viewer who never enables an effect keeps a byte-identical audio path.
     */
    const ensureGraph = useCallback((): EnhancerGraph | null => {
        if (graphRef.current) return graphRef.current;
        const video = videoRef.current;
        if (!video) return null;

        try {
            const w = window as unknown as {
                AudioContext: typeof AudioContext;
                webkitAudioContext?: typeof AudioContext;
            };
            const Ctor = w.AudioContext ?? w.webkitAudioContext;
            if (!Ctor) return null;

            const ctx = new Ctor();
            graphRef.current = createEnhancerGraph(ctx, ctx.createMediaElementSource(video));
            return graphRef.current;
        } catch {
            // A tainted element, a blocked context, or a second tap on the same
            // element all land here. Fail permanently and stay out of the way,
            // rather than leaving the viewer with silence.
            setFailed(true);
            return null;
        }
    }, [videoRef]);

    // Snapshot of the settings the effect last saw, to tell a mid-playback
    // toggle (a real gesture is behind it) apart from a mount (never one).
    const lastSnapRef = useRef<string | null>(null);

    useEffect(() => {
        if (!supported || failed) return;
        // Nothing enabled and nothing built yet: leave the element untouched.
        if (!settings.clarity && !settings.widen && !graphRef.current) return;

        const snap = `${settings.clarity}|${settings.widen}|${settings.width}`;
        const changed = lastSnapRef.current !== null && lastSnapRef.current !== snap;
        lastSnapRef.current = snap;

        const build = (): boolean => {
            const graph = ensureGraph();
            if (!graph) return false;
            try {
                applyEnhancerSettings(graph, settings);
            } catch {
                setFailed(true);
                return false;
            }
            const ctx = graph.ctx as AudioContext;
            if (ctx.state === 'suspended') void ctx.resume();
            return true;
        };

        if (graphRef.current || changed) {
            // Already tapped, or the viewer just flipped a toggle (a gesture,
            // so resume usually succeeds immediately): build/apply now.
            build();
            return undefined;
        }

        /*
         * Fresh element with saved prefs on: NEVER tap it here.
         *
         * This effect runs pre-gesture at mount — and twice under StrictMode.
         * Tapping now parks the element on a suspended context (silence, not
         * bypass), and the second run throws (one element, one lifetime tap),
         * which trips the "browser refused audio" notice and, worse, leaves
         * the element captured by the closed first context: unmuting then
         * yields permanent silence. So arm one-time gesture listeners instead:
         * the tap lands inside a real gesture, the context starts running,
         * and double registration is harmless because the second firing finds
         * the graph already built.
         */
        let cancelled = false;
        const events = ['pointerdown', 'keydown', 'touchstart'] as const;
        const detach = () => {
            for (const event of events) {
                document.removeEventListener(event, onGesture, { capture: true } as EventListenerOptions);
            }
        };
        function onGesture() {
            if (cancelled) return;
            if (build()) detach();
        }
        for (const event of events) {
            document.addEventListener(event, onGesture, { once: true, capture: true });
        }
        return () => {
            cancelled = true;
            detach();
        };
    }, [supported, failed, settings, settings.clarity, settings.widen, ensureGraph]);

    // The graph outlives src changes because the element is the same one, but a
    // real unmount has to release the context or navigation leaks them.
    useEffect(() => {
        return () => {
            const graph = graphRef.current;
            if (!graph) return;
            graphRef.current = null;
            try {
                graph.source.disconnect();
                void (graph.ctx as AudioContext).close();
            } catch {
                /* already torn down */
            }
        };
    }, []);

    return { supported, active, failed };
}
