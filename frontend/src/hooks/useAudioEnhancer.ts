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

    useEffect(() => {
        if (!supported || failed) return;
        // Nothing enabled and nothing built yet: leave the element untouched.
        if (!settings.clarity && !settings.widen && !graphRef.current) return;

        const graph = ensureGraph();
        if (!graph) return;

        try {
            applyEnhancerSettings(graph, settings);
        } catch {
            setFailed(true);
            return;
        }

        /*
         * Resuming is not optional, and a toggle is not the only way in here.
         *
         * When the setting was saved from a previous visit the effect runs at
         * mount, with no gesture behind it, so the context starts suspended —
         * and because the element has already been tapped by then, suspended
         * means the audio has nowhere to go. Not "no effect": silence.
         *
         * So try immediately for the toggle case, and otherwise wait for the
         * first gesture of any kind and try again.
         */
        const ctx = graph.ctx as AudioContext;
        if (ctx.state !== 'suspended') return undefined;

        void ctx.resume();
        const wake = () => { void ctx.resume(); };
        const events = ['pointerdown', 'keydown', 'touchstart'] as const;
        for (const event of events) {
            document.addEventListener(event, wake, { once: true, capture: true });
        }
        return () => {
            for (const event of events) {
                document.removeEventListener(event, wake, { capture: true } as EventListenerOptions);
            }
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
