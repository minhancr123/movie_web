'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
import {
    Play, Pause, Maximize, Minimize, Volume2, Volume1, VolumeX,
    RotateCcw, RotateCw, Settings, SkipForward, Loader2, Captions, X
} from 'lucide-react';
import { useWatchHistory } from '../hooks/useLocalStorage';
import { playbackAPI, apiUrl } from '@/lib/api';
import { detectCapabilities } from '@/lib/capabilities';
import {
    fetchCues, activeCues,
    isEmbeddedTrack, trackSource, isViTrack, isEnTrack, isReadyTrack,
    type SubCue, type SubTrack,
} from '@/lib/subtitles';
import { computeResumeAt, pickDisplayDuration, decideSeekTarget, planResume, shouldAutoplayAfterRebuild, shouldDowngradeForDropped, subtitleLookupTime } from '@/lib/playback-progress';
import {
    useAudioEnhancer, DEFAULT_AUDIO_ENHANCER,
    type AudioEnhancerSettings,
} from '../hooks/useAudioEnhancer';
import { clampLipSyncMs } from '@/lib/audioEnhancerGraph';
import { isTaintFreePipeline } from '@/lib/mediaPipeline';
import { CINEMA_BRIGHT_ATTR, type CinemaMode } from '@/components/CinemaLayer';
import { readShaderEnabled, setShaderEnabled } from '@/lib/shaderPref';
import { clampWidth } from '@/lib/audioEnhancerGraph';

/** ISO-639 code -> Vietnamese name, for the subtitle-match notices. */
const SUB_LANG_NAMES: Record<string, string> = {
    vi: 'Phụ đề Việt',
    vie: 'Phụ đề Việt',
    en: 'Phụ đề Anh',
    eng: 'Phụ đề Anh',
};
const subLangName = (code: string) => SUB_LANG_NAMES[code.toLowerCase()] || `Phụ đề ${code.toUpperCase()}`;

interface VideoPlayerProps {
    src: string;
    /**
     * Bearer token for backend-hosted HLS assets (/api/playback/hls/...).
     * The backend re-checks session ownership on every segment, so the player
     * must attach it to playlist and segment requests too.
     */
    authToken?: string;
    durationSeconds?: number | null;
    movie: {
        name: string;
        slug: string;
        poster_url: string;
        origin_name: string;
        quality: string;
    };
    episode: {
        name: string;
        slug: string;
    };
    onNextEpisode?: () => void;
    /**
     * Subtitle/audo inventory context. The player lazily asks the backend
     * which embedded audio + text-subtitle tracks the playing source has and
     * fetches extracted WebVTT sidecars — nothing is probed until the user
     * opens the subtitle menu.
     */
    subContext?: {
        type: string;
        tmdbId: number;
        season?: number | null;
        episode?: number | null;
        sourceToken?: string;
        playbackSessionId?: string;
    } | null;
    /** Embedded audio track choice (ffprobe order). Switching re-resolves the
        same release with the chosen track and resumes from history. */
    onPickAudio?: (index: number) => void;
    activeAudioIndex?: number | null;
    /** Audio switch in flight (ffprobe-order index): spinner on the target. */
    pendingAudioIndex?: number | null;
    /** Ask the parent resolver for a fresh URL/session after local recovery is exhausted. */
    onPlaybackFailure?: (reason: string) => void;
    /** Bumped by the parent when a recovery resolves the identical URL.
        React bails out on an unchanged src, so this forces the pipeline below
        to tear down and rebuild (fresh hls.js + resume from history). */
    reloadKey?: number;
    /**
     * Display offset (seconds) of this session: 0 for ordinary from-the-start
     * sessions, >0 when the server began the (re)mux at a seek target. The
     * playlist timeline is 0-based over truncated bytes; the viewer-facing
     * timeline is offset by this amount.
     */
    startAt?: number | null;
    /**
     * Ask the parent resolver for a session beginning at a display position
     * (far seeks past the written playlist head). Absent for sources that
     * cannot re-resolve (direct files), where seeks clamp instead. May be
     * async: the player watches settlement to clear its seeking indicator.
     */
    onSeekToPosition?: (displaySeconds: number) => void | Promise<unknown>;
    /**
     * Invalidate an in-flight seek-resolve (the viewer retargeted or went
     * back to direct seeking): the parent drops its late response instead of
     * yanking playback to an abandoned position.
     */
    onCancelSeek?: () => void;
    /**
     * Live progress of the in-flight seek-resolve (stage label + warm
     * percent), so a 30-60s server warm reads as progress instead of a dead
     * overlay that invites mashing. Null when no seek is resolving.
     */
    seekProgress?: { label?: string | null; percent?: number | null } | null;
    /** Fired when currentTime advances past the stall threshold. Lets the
        parent reset its recovery counter so isolated stalls don't accumulate. */
    /** Live playhead in full-film seconds (display time, not element time). */
    onPlaybackProgress?: (positionSeconds: number) => void;
    /** How far this remux's clock leads source time (B-frame reorder delay). */
    presentationShiftMs?: number;
    /** False when the server serves whole films by policy, never truncated ones. */
    seekStartSupported?: boolean;
    /** Fired once per source when the decoder drops frames heavily
        (audio permanently ahead of the picture). The parent can step down
        to a lighter release instead of leaving every heavy title lagging. */
    onDecodeOverload?: () => void;
    /**
     * The surround mode and the element to sample. Both are emitted rather than
     * used here: the player's own box clips its overflow, so the light has to be
     * drawn by an ancestor to spill past the bezel.
     */
    onCinemaChange?: (mode: CinemaMode) => void;
    onVideoReady?: (el: HTMLVideoElement | null) => void;
    /**
     * Optional shell shared with the ambient layer. Requesting fullscreen on
     * this element keeps the glow in the browser's fullscreen subtree.
     */
    fullscreenTargetRef?: React.RefObject<HTMLDivElement | null>;
}

export default function VideoPlayer({ src, movie, episode, authToken, durationSeconds, onNextEpisode, subContext, onPickAudio, activeAudioIndex, pendingAudioIndex = null, onPlaybackFailure, reloadKey = 0, onPlaybackProgress, presentationShiftMs = 0, seekStartSupported = true, onDecodeOverload, onCinemaChange, onVideoReady, fullscreenTargetRef, startAt = 0, onSeekToPosition, onCancelSeek, seekProgress = null }: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [isPiP, setIsPiP] = useState(false);
    const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
    const [buffered, setBuffered] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // True once the element has actually shown picture (currentTime advances
    // past the first half second). A black loading frame with auto-hidden
    // controls reads as "the player vanished", so the hide rules below all
    // require this — and a poster covers the black meanwhile.
    const [hasPicture, setHasPicture] = useState(false);
    // Audible play() rejected for lack of gesture: show tap-to-play instead of
    // silent autoplay. Cleared on the first real play event.
    const [autoplayBlocked, setAutoplayBlocked] = useState(false);
    // Re-mount the playback pipeline (fresh hls.js + resume from history).
    const [retryKey, setRetryKey] = useState(0);

    // Player display prefs, persisted on this device.
    type VideoScale = 'contain' | 'cover' | 'fill';
    const readPrefs = (): {
        scale: VideoScale; subSize: number; subColor: string;
        audio: AudioEnhancerSettings; cinema: CinemaMode;
    } => {
        const fallback = {
            scale: 'contain' as VideoScale, subSize: 20, subColor: '#ffffff',
            audio: DEFAULT_AUDIO_ENHANCER, cinema: 'off' as CinemaMode,
        };
        try {
            const raw = localStorage.getItem('cine_player_prefs');
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return {
                scale: ['contain', 'cover', 'fill'].includes(parsed.scale) ? parsed.scale : fallback.scale,
                subSize: [16, 20, 26, 32].includes(Number(parsed.subSize)) ? Number(parsed.subSize) : fallback.subSize,
                subColor: typeof parsed.subColor === 'string' && /^#[0-9a-f]{6}$/i.test(parsed.subColor) ? parsed.subColor : fallback.subColor,
                audio: {
                    clarity: parsed.audio?.clarity === true,
                    width: clampWidth(Number(parsed.audio?.width)),
                    // Widening stays opt-in on every load: it flatters some
                    // mixes and hollows out others, so it must never be the
                    // state a viewer finds themselves in without choosing it.
                    widen: parsed.audio?.widen === true,
                    // Lip-sync compensation is setup-constant (same display
                    // chain every film), so unlike widen it persists.
                    lipSyncMs: clampLipSyncMs(Number(parsed.audio?.lipSyncMs)),
                },
                cinema: (['off', 'dim', 'ambilight'] as const).includes(parsed.cinema)
                    ? (parsed.cinema as CinemaMode)
                    // Older builds stored a boolean here; true meant the glow.
                    : parsed.cinema === true ? 'ambilight' : fallback.cinema,
            };
        } catch {
            return fallback;
        }
    };
    const [videoScale, setVideoScale] = useState<VideoScale>(() =>
        typeof window === 'undefined' ? 'contain' : readPrefs().scale);
    const [subSize, setSubSize] = useState<number>(() =>
        typeof window === 'undefined' ? 20 : readPrefs().subSize);
    const [subColor, setSubColor] = useState<string>(() =>
        typeof window === 'undefined' ? '#ffffff' : readPrefs().subColor);
    const [audioFx, setAudioFx] = useState<AudioEnhancerSettings>(() =>
        typeof window === 'undefined' ? DEFAULT_AUDIO_ENHANCER : readPrefs().audio);
    // Web Audio can only tap the element on the MSE path; the hook decides and
    // reports back so the UI can say why it is unavailable instead of going quiet.
    const audioFxStatus = useAudioEnhancer(
        videoRef, src, typeof window !== 'undefined' && Hls.isSupported(), audioFx,
    );
    const [cinema, setCinema] = useState<CinemaMode>(() =>
        typeof window === 'undefined' ? 'off' : readPrefs().cinema);
    // Lives outside the player's own prefs: page layouts mount the shader, so
    // the flag has to be readable from components this one never renders.
    const [shaderOn, setShaderOn] = useState(true);
    useEffect(() => setShaderOn(readShaderEnabled()), []);
    // Only the glow reads pixels back, so only the glow needs a taint-free
    // pipeline; dimming the room works on any stream.
    const canSampleFrames = typeof window !== 'undefined'
        && isTaintFreePipeline(src, Hls.isSupported());
    const effectiveCinema: CinemaMode =
        cinema === 'ambilight' && !canSampleFrames ? 'off' : cinema;

    useEffect(() => {
        onCinemaChange?.(effectiveCinema);
    }, [effectiveCinema, onCinemaChange]);
    // The surround lives in the parent, so it has to be handed back the element
    // it samples, and told to stop when this player goes away.
    useEffect(() => {
        onVideoReady?.(videoRef.current);
        return () => {
            onVideoReady?.(null);
            onCinemaChange?.('off');
        };
    }, [onVideoReady, onCinemaChange]);

    const changeCinema = (next: CinemaMode) => {
        setCinema(next);
        savePrefs({ cinema: next });
    };

    const updateAudioFx = (next: AudioEnhancerSettings) => {
        setAudioFx(next);
        savePrefs({ audio: next });
    };
    // Manual subtitle delay (seconds) for currently selected track.
    const [subDelay, setSubDelay] = useState<number>(0);
    // Secondary subtitle offset relative to primary in bilingual mode.
    const [secondaryOffset, setSecondaryOffset] = useState<number>(0);

    const [syncToast, setSyncToast] = useState<string | null>(null);
    const syncToastTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);

    const showSyncToast = useCallback((msg: string) => {
        if (syncToastTimerRef.current) clearTimeout(syncToastTimerRef.current);
        setSyncToast(msg);
        syncToastTimerRef.current = setTimeout(() => {
            setSyncToast(null);
            syncToastTimerRef.current = undefined;
        }, 2200);
    }, []);

    const savePrefs = (next: {
        scale?: VideoScale; subSize?: number; subColor?: string; subDelay?: number;
        audio?: AudioEnhancerSettings; cinema?: CinemaMode;
    }) => {
        try {
            localStorage.setItem('cine_player_prefs', JSON.stringify({ ...readPrefs(), ...next }));
        } catch {
            // storage unavailable — prefs just don't persist
        }
    };

    const patchPrefs = (patch: Partial<{ scale: VideoScale; subSize: number; subColor: string; subDelay: number }>) => {
        try {
            const raw = localStorage.getItem('cine_player_prefs');
            const current = raw ? JSON.parse(raw) : {};
            localStorage.setItem('cine_player_prefs', JSON.stringify({ ...current, ...patch }));
        } catch {}
    };

    const readDelayMap = (): Record<string, number> => {
        try {
            const raw = localStorage.getItem('cine_sub_delay_map');
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    };
    const subDelayRef = useRef(subDelay);
    useEffect(() => { subDelayRef.current = subDelay; }, [subDelay]);
    const selectedSubRef = useRef<string>('off');
    // True until the viewer manually picks a subtitle track: only auto-picks
    // may be replaced when a better (file-matched) list arrives. A manual
    // choice always sticks, even if an embedded track shows up later.
    const autoSubRef = useRef(true);
    // Timing base of the auto-picked track. An online pick upgrades to an
    // embedded one; anything else never moves on its own.
    const autoSubSourceRef = useRef<string | null>(null);

    const adjustSubDelay = useCallback((delta: number) => {
        // Tenths, not halves. The pipeline's own timing is exact now, so what
        // is left to dial out is a sidecar written for a different release —
        // typically a few hundred milliseconds, which a 0.5s step can only
        // overshoot. Key repeat still covers a large offset quickly.
        const next = Math.min(30, Math.max(-30, Math.round((subDelayRef.current + delta) * 10) / 10));
        subDelayRef.current = next;
        setSubDelay(next);
        patchPrefs({ subDelay: next });
        const sign = next > 0 ? `+${next.toFixed(1)}` : `${next.toFixed(1)}`;
        showSyncToast(`Đồng bộ phụ đề: ${sign}s ${delta > 0 ? '(sớm hơn)' : delta < 0 ? '(trễ hơn)' : ''}`);
        const trackId = selectedSubRef.current;
        if (trackId && trackId !== 'off') {
            try {
                const map = readDelayMap();
                map[trackId] = next;
                localStorage.setItem('cine_sub_delay_map', JSON.stringify(map));
            } catch {}
        }
    }, [showSyncToast]);

    const adjustSecondaryOffset = useCallback((delta: number) => {
        setSecondaryOffset((prev) => {
            const next = Math.min(15, Math.max(-15, Math.round((prev + delta) * 2) / 2));
            const sign = next > 0 ? `+${next.toFixed(1)}` : `${next.toFixed(1)}`;
            showSyncToast(`Lệch phụ đề 2: ${sign}s ${delta > 0 ? '(sớm hơn)' : delta < 0 ? '(trễ hơn)' : ''}`);
            return next;
        });
    }, [showSyncToast]);

    const currentTimeRef = useRef(0);
    useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
    const rafRef = useRef<number | undefined>(undefined);

    const SUB_SIZES = [16, 20, 26, 32];
    const SUB_COLORS = [
        { name: 'Trắng', value: '#ffffff' },
        { name: 'Vàng', value: '#fde047' },
        { name: 'Cyan', value: '#67e8f9' },
        { name: 'Xanh lá', value: '#86efac' },
    ];
    const stallTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
    const lastProgressRef = useRef(0);
    const localStallRecoveryRef = useRef(false);
    const hlsRef = useRef<Hls | null>(null);
    // Latest history save, callable from pause/pagehide handlers that live in
    // other effects. The saver itself skips paused elements, so callers that
    // run *because* of a pause pass force=true.
    const saveProgressRef = useRef<((force?: boolean) => void) | null>(null);
    // Deferred resume listener (removed in the pipeline effect cleanup).
    const resumeListenerRef = useRef<(() => void) | null>(null);
    // In-flight far-seek target (display seconds). Declared up here because
    // togglePlay (below) reads it; the debounced fire effect lives further
    // down next to handleSeek.
    const [seekTarget, setSeekTarget] = useState<number | null>(null);
    const seekTargetRef = useRef<number | null>(null);
    const beginSeekLock = (at: number) => {
        seekTargetRef.current = at;
        setSeekTarget(at);
        const video = videoRef.current;
        if (video) {
            userPausedRef.current = true;
            try {
                video.pause();
            } catch {}
            setIsPlaying(false);
        }
    };
    const clearSeekLock = () => {
        seekTargetRef.current = null;
        setSeekTarget(null);
    };
    const seekFireEpochRef = useRef(0);
    const seekFiredEpochRef = useRef(0);
    // One auto-resume seek per title per mount. A resume past the fresh remux
    // head fires a seek-resolve; if the server answers it from-start anyway
    // (seek bucketing), the rebuild would resume with the SAME target again —
    // an endless resolve/supersede loop ("hiện phim rồi mà vẫn load tiếp").
    // Manual seeks bypass this (different path) and stay repeatable.
    const resumeFiredKeyRef = useRef<string | null>(null);
    // Playback intent across pipeline rebuilds (recovery, seek sessions):
    // a rebuild of a paused player must stay paused, never auto-play.
    // userPausedRef tracks the LATEST intent continuously (pause/play
    // events); pausedBeforeRebuildRef snapshots the element at teardown as a
    // backstop for rebuilds that happen without events in between.
    const hasPlayedRef = useRef(false);
    const pausedBeforeRebuildRef = useRef(false);
    const userPausedRef = useRef(false);

    /** Restart hls.js once before replacing the server-side remux. The two
        deadlines still total 20s, but a recoverable loader stall gets nudged
        after 8s instead of leaving the viewer on a frozen frame for all 20. */
    const LOCAL_STALL_RECOVERY_MS = 15000; // Increased from 8s to 15s to allow for cold resumes
    const ESCALATED_STALL_TIMEOUT_MS = 25000; // Increased from 12s to 25s
    const armStallTimer = (timeoutMs = LOCAL_STALL_RECOVERY_MS) => {
        // This is a rolling deadline, not a one-shot "waiting" alarm. Browsers
        // can report playing/canplay and keep readyState > 0 while currentTime
        // is frozen, so progress itself must keep renewing the watchdog.
        if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
        lastProgressRef.current = videoRef.current?.currentTime ?? 0;
        stallTimerRef.current = setTimeout(() => {
            stallTimerRef.current = undefined;
            const video = videoRef.current;
            if (video && !video.paused && !video.ended) {
                // A trickling CDN (a frame every ~10s) defeats a "did it move
                // at all" check while looking frozen to the viewer: demand
                // meaningful advance (2s per 15s window, ~0.13x). Normal
                // playback advances ~15s and renews; genuine stalls fire.
                if (video.currentTime > lastProgressRef.current + 2) {
                    localStallRecoveryRef.current = false;
                    armStallTimer();
                    return;
                }

                const hls = hlsRef.current;
                if (hls && !localStallRecoveryRef.current) {
                    localStallRecoveryRef.current = true;
                    hls.stopLoad();
                    hls.startLoad(video.currentTime || -1);
                    void video.play().catch(() => { /* autoplay may need a gesture */ });
                    armStallTimer(ESCALATED_STALL_TIMEOUT_MS);
                    return;
                }

                localStallRecoveryRef.current = false;
                setIsLoading(false);
                const reason = 'Luồng phát không tiến triển trong 20 giây.';
                if (onPlaybackFailure) onPlaybackFailure(reason);
                else setError(`${reason} Bấm Thử lại để nối lại.`);
            }
        }, timeoutMs);
    };
    const clearStallTimer = () => {
        if (stallTimerRef.current) {
            clearTimeout(stallTimerRef.current);
            stallTimerRef.current = undefined;
        }
        localStallRecoveryRef.current = false;
    };

    // Subtitles: cheap external inventory is prefetched; embedded extraction is
    // loaded lazily only when the user opens the menu and no sidecar exists.
    type SubStatus = 'idle' | 'loading' | 'ready' | 'error';
    const [subStatus, setSubStatus] = useState<SubStatus>('idle');
    const [subTracks, setSubTracks] = useState<SubTrack[]>([]);
    const [subAudio, setSubAudio] = useState<{ language: string; label: string; codec: string; channels: number | null }[]>([]);
    const [probeSubs, setProbeSubs] = useState<{ language: string; label: string; codec: string; convertible: boolean }[]>([]);
    // Per-language verdict from OpenSubtitles on whether any subtitle was timed
    // for this exact file. Drives the 'expect drift' warning in the menu.
    const [subMatch, setSubMatch] = useState<{ checked: boolean; languages: Record<string, { matched: boolean; release: string; count: number }> }>({ checked: false, languages: {} });
    const [subNote, setSubNote] = useState('');
    const [subError, setSubError] = useState('');
    const [selectedSub, setSelectedSub] = useState<string>('off');
    const [bilingual, setBilingual] = useState(false);
    const [secondarySub, setSecondarySub] = useState<string>('');
    const [cueCache, setCueCache] = useState<Record<string, SubCue[]>>({});
    const [cuesLoading, setCuesLoading] = useState(false);
    const [subJobId, setSubJobId] = useState<string | null>(null);
    const subLoadModeRef = useRef<'idle' | 'external' | 'full'>('idle');
    const subHasTracksRef = useRef(false);
    const subRequestInFlightRef = useRef(false);
    const subRequestFullAfterRef = useRef(false);

    // Best Vietnamese pick: a file-exact embedded track first, otherwise the
    // addon's first Vietnamese sidecar (timed for some release of the title —
    // right language, timing not guaranteed; see the match verdict in the menu).
    const bestViTrack = (tracks: SubTrack[]) =>
        tracks.find((t) => isReadyTrack(t) && isViTrack(t) && isEmbeddedTrack(t))
        || tracks.find((t) => isReadyTrack(t) && isViTrack(t));

    // Auto-select Vietnamese, upgrading to a file-matched track when one
    // appears later. The background prefetch returns online-only lists, while
    // the session-backed inventory (or a finished extraction job) can add
    // embedded tracks afterwards — without this the first generic
    // "Tiếng Việt 1" would stick forever even after the synced track lands.
    const maybeAutoPickSub = useCallback((tracks: SubTrack[]) => {
        if (!autoSubRef.current) return;
        const currentId = selectedSubRef.current;
        const best = bestViTrack(tracks);
        if (!best) return;
        if (currentId === 'off' || currentId === '') {
            autoSubSourceRef.current = trackSource(best);
            setSelectedSub(best.id);
            void ensureCues(best);
            return;
        }
        if (autoSubSourceRef.current !== 'embedded' && isEmbeddedTrack(best) && best.id !== currentId) {
            autoSubSourceRef.current = 'embedded';
            setSelectedSub(best.id);
            void ensureCues(best);
            showSyncToast('Đã chuyển sang phụ đề nhúng khớp file đang xem');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showSyncToast]);

    // Bilingual partner: same timing base as the primary whenever possible.
    // Two sidecars from different releases drift progressively (fps/cut
    // differences), which no constant offset can fix — same-source pairing
    // (embedded↔embedded especially) avoids that entirely.
    const pickSecondaryFor = (primary: SubTrack | undefined, tracks: SubTrack[]) => {
        if (!primary) return undefined;
        const pool = tracks.filter((t) => t.id !== primary.id && isReadyTrack(t));
        if (pool.length === 0) return undefined;
        const primaryVi = isViTrack(primary);
        const primaryLang2 = primary.language.toLowerCase().slice(0, 2);
        const langMatch = (t: SubTrack) => primaryVi ? isEnTrack(t) : isViTrack(t);
        const sameSource = (t: SubTrack) => trackSource(t) === trackSource(primary);
        const otherLang = (t: SubTrack) => !t.language.toLowerCase().startsWith(primaryLang2);
        return pool.find((t) => langMatch(t) && sameSource(t))
            || pool.find((t) => langMatch(t))
            || pool.find((t) => sameSource(t) && otherLang(t))
            || pool.find(otherLang)
            || pool[0];
    };

    const applyTracks = useCallback((tracks: SubTrack[]) => {
        setSubTracks(tracks);
        // Selection itself follows in the [subTracks] effect below so every
        // list improvement (prefetch → session inventory → extraction job)
        // runs the same upgrade logic exactly once per list.
    }, []);

    const loadSubtitleInventory = useCallback(async (allowEmbedded = false) => {
        if (!subContext) return;
        if (subLoadModeRef.current === 'full') return;
        if (subLoadModeRef.current === 'external' && (subHasTracksRef.current || !allowEmbedded)) return;
        if (subRequestInFlightRef.current) {
            if (allowEmbedded) subRequestFullAfterRef.current = true;
            return;
        }
        subRequestInFlightRef.current = true;
        setSubStatus('loading');
        setSubError('');
        try {
            const res = await playbackAPI.subtitles({
                type: subContext.type,
                tmdbId: subContext.tmdbId,
                season: subContext.season ?? undefined,
                episode: subContext.episode ?? undefined,
                capabilities: detectCapabilities(),
                ...(subContext.sourceToken ? { sourceToken: subContext.sourceToken } : {}),
                ...(subContext.playbackSessionId ? { playbackSessionId: subContext.playbackSessionId } : {}),
                externalOnly: !allowEmbedded,
            });
            const data = res.data?.data || {};
            const tracks: SubTrack[] = Array.isArray(data.tracks) ? data.tracks : [];
            setSubAudio(Array.isArray(data.audio) ? data.audio : []);
            setProbeSubs(Array.isArray(data.probe?.subtitles) ? data.probe.subtitles : []);
            setSubNote(typeof data.note === 'string' ? data.note : '');
            setSubMatch(data.match && typeof data.match === 'object' ? data.match : { checked: false, languages: {} });
            setSubStatus('ready');
            subHasTracksRef.current = tracks.length > 0;
            subLoadModeRef.current = allowEmbedded ? 'full' : 'external';
            applyTracks(tracks);
            if (typeof data.jobId === 'string' && data.jobId) {
                setSubJobId(data.jobId);
            }
        } catch (err: unknown) {
            const message =
                (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
                'Không tải được danh sách phụ đề';
            setSubError(message);
            setSubStatus('error');
            subLoadModeRef.current = 'idle';
        } finally {
            subRequestInFlightRef.current = false;
            if (subRequestFullAfterRef.current) {
                subRequestFullAfterRef.current = false;
                void loadSubtitleInventory(true);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subContext?.type, subContext?.tmdbId, subContext?.season, subContext?.episode, subContext?.sourceToken, subContext?.playbackSessionId]);

    // Warm the cheap external subtitle lookup in the background. It never
    // starts embedded ffmpeg extraction, so playback bandwidth stays untouched.
    useEffect(() => {
        if (!subContext) return;
        const timer = setTimeout(() => void loadSubtitleInventory(false), 800);
        return () => clearTimeout(timer);
    }, [loadSubtitleInventory]);

    // No client-side audio default: the backend picks the film's own language
    // (TMDB original_language matched against ffprobe tags, English fallback)
    // and every resolve response carries audioIndex, which the parent applies.
    // The old English-first preempt here used to fire a competing resolve that
    // overrode the backend default with English on non-English films.

    // Poll the background extraction job; tracks flip to ready as VTTs land.
    useEffect(() => {
        if (!subJobId) return;
        let cancelled = false;
        let polls = 0;
        const timer = setInterval(async () => {
            polls += 1;
            if (polls > 45) {
                clearInterval(timer);
                if (!cancelled) setSubJobId(null);
                return;
            }
            try {
                const res = await playbackAPI.subtitleJob(subJobId);
                const job = res.data?.data;
                if (!job || cancelled) return;
                const ready: Record<string, string> = job.ready || {};
                if (Object.keys(ready).length > 0) {
                    setSubTracks((prev) =>
                        prev.map((t) => (ready[t.id] ? { ...t, url: ready[t.id], ready: true } : t))
                    );
                }
                if (job.done || job.error) {
                    clearInterval(timer);
                    if (!cancelled) {
                        setSubJobId(null);
                        if (job.error) setSubNote(job.error);
                    }
                }
            } catch {
                // Transient poll failure: keep polling until the cap.
            }
        }, 4000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [subJobId]);

    // Follow file-matched tracks as the inventory improves: background
    // prefetch (online-only) → session-backed list (may add embedded) →
    // extraction-job results (embedded URLs landing). Runs once per list.
    useEffect(() => {
        maybeAutoPickSub(subTracks);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subTracks]);

    // An embedded track can be auto-selected before its extraction job
    // finishes and its URL lands: at that moment ensureCues is skipped
    // (it needs a url). Watch the selected track and fire it the moment
    // a URL appears so subtitles appear as soon as the file is readable.
    useEffect(() => {
        if (selectedSub === 'off' || !selectedSub) return;
        const track = subTracks.find((t) => t.id === selectedSub);
        if (track?.url && !cueCache[track.id]) void ensureCues(track);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSub, subTracks, cueCache]);

    const ensureCues = useCallback(async (track: SubTrack) => {
        if (cueCache[track.id] || !track.url) return;
        setCuesLoading(true);
        try {
            const cues = await fetchCues(apiUrl(track.url));
            setCueCache((prev) => ({ ...prev, [track.id]: cues }));
        } catch {
            // Keep the track selectable; the overlay simply shows nothing while
            // the file fails. A retry happens on next select.
            setCueCache((prev) => ({ ...prev, [track.id]: [] }));
        } finally {
            setCuesLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(Object.keys(cueCache))]);

    const pickSubtitle = (id: string) => {
        // A manual pick always sticks: the auto-upgrade above must not yank
        // the viewer off a track they chose themselves.
        autoSubRef.current = false;
        setSelectedSub(id);
        const track = subTracks.find((t) => t.id === id);
        if (track) void ensureCues(track);
        if (id === 'off') {
            setBilingual(false);
        } else if (bilingual && (id === secondarySub || !secondarySub)) {
            const newSec = pickSecondaryFor(track, subTracks);
            if (newSec) {
                setSecondarySub(newSec.id);
                void ensureCues(newSec);
            }
        }
    };

    // NOTE: there is deliberately no "auto-prefer English" effect beyond the
    // initial pick above. An earlier version re-forced English whenever the
    // current track wasn't English, which fought the viewer: picking Vietnamese
    // immediately bounced back to English, so switching tracks never stuck.

    // Restore delay memory when subtitle track is picked (per-track delay)
    useEffect(() => {
        selectedSubRef.current = selectedSub;
        if (!selectedSub || selectedSub === 'off') {
            subDelayRef.current = 0;
            setSubDelay(0);
            return;
        }
        const stored = readDelayMap()[selectedSub];
        const delay = Number.isFinite(stored) ? stored : 0;
        subDelayRef.current = delay;
        setSubDelay(delay);
    }, [selectedSub]);

    // Display timeline: the element plays truncated 0-based bytes while the
    // viewer sees positions offset by the session's start (0 = from the start).
    const sessionStartAt = typeof startAt === 'number' && Number.isFinite(startAt) && startAt > 0 ? startAt : 0;
    const displayTime = sessionStartAt + currentTime;
    // Full-length duration for the seek bar and readout: the element duration
    // of a seek-started session only covers its truncated tail.
    const fullDuration = durationSeconds || duration || 0;

    // Subtitle files are timed against the full film's source clock, which the
    // remux leads by its B-frame reorder delay; the session offset goes back on
    // top, and the viewer's manual nudge after that.
    const subLookupTime = subtitleLookupTime({
        sessionStart: sessionStartAt,
        elementTime: currentTime,
        delay: subDelay,
        presentationShiftMs,
    });
    // Secondary subtitle has its own relative offset for fine-tuning in bilingual mode.
    const secondaryLookupTime = subLookupTime + secondaryOffset;

    const primaryCues = React.useMemo(() => {
        if (!selectedSub || selectedSub === 'off') return [];
        return activeCues(cueCache[selectedSub] || [], subLookupTime);
    }, [cueCache, selectedSub, subLookupTime]);

    const secondaryCues = React.useMemo(() => {
        if (!bilingual || !secondarySub || secondarySub === selectedSub) return [];
        // Show only cues that actually cover the current time.
        //
        // This used to fall back to nearestCue(±2s) whenever the secondary
        // track had a gap while the primary was showing, so the second language
        // displayed a sentence nobody was saying — up to two seconds off. Two
        // subtitle files almost never share cue boundaries, so that fallback
        // fired on most lines and made bilingual mode look permanently out of
        // sync. Genuine constant drift between two releases is what the manual
        // secondaryOffset control is for.
        return activeCues(cueCache[secondarySub] || [], secondaryLookupTime);
    }, [cueCache, bilingual, secondarySub, selectedSub, secondaryLookupTime]);

    // High-frequency RAF loop for smooth frame-accurate subtitle sync
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        let rafId: number;
        const checkTime = () => {
            if (!video.paused && !video.ended) {
                const now = video.currentTime;
                // 40ms threshold (~25fps) completely eliminates the 250-350ms delay of timeupdate
                if (Math.abs(now - currentTimeRef.current) >= 0.04) {
                    currentTimeRef.current = now;
                    setCurrentTime(now);
                    // Same-value sets bail out, so this is free after the
                    // first frame: marks real picture for the hide rules.
                    if (now > 0.5) setHasPicture(true);
                }
            }
            rafId = requestAnimationFrame(checkTime);
        };

        rafId = requestAnimationFrame(checkTime);
        return () => {
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [src, retryKey]);

    const controlsTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
    const loadingTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
    const { history, addToHistory } = useWatchHistory();

    const toggleSettings = () => {
        const next = !showSettings;
        setShowSettings(next);
        // External subtitle inventory is prefetched in the background. Opening
        // settings permits the slower embedded-track fallback only when needed.
        if (next) void loadSubtitleInventory(true);
    };

    const changePlaybackSpeed = (speed: number) => {
        if (videoRef.current) {
            videoRef.current.playbackRate = speed;
            setPlaybackSpeed(speed);
            setShowSettings(false);
        }
    };

    // Format time (seconds -> MM:SS)
    const formatTime = (time: number) => {
        if (!time || isNaN(time)) return "00:00";
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    };

    // Initialize playback: HLS (remux playlists, .m3u8) via hls.js / native,
    // progressive files (direct TorBox URLs: mp4/webm/mkv) via plain <video>.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        setError(null);
        setIsLoading(true);
        // Fresh pipeline, no picture yet: poster covers the black gap below
        // until the first frame lands (set in the RAF loop).
        setHasPicture(false);
        // A new pipeline means the seek (if any) landed: drop its indicator.
        // Failures clear it via the fire-promise catch above instead. If this
        // line clears a seek but the session does NOT begin at the requested
        // point, the mismatch toast below says so.
        if (seekTargetRef.current !== null && typeof window !== 'undefined') {
            console.debug(`[seek] overlay cleared by pipeline rebuild (src=${src.slice(0, 80)}, startAt=${sessionStartAt})`);
        }
        // A remux session that does not begin at the requested point means one
        // of two very different things, and telling the viewer the wrong one is
        // worse than saying nothing. When the server offers truncated sessions
        // and still did not honour the seek, something is broken. When it serves
        // whole films by policy, nothing is wrong — the film is simply still
        // being built up to that point, and "restart the backend" would be
        // nonsense advice. (Direct files and Vimo carry whole-file timelines, so
        // the check is remux-only.)
        // Only complain about a MATERIAL gap. The server rounds a start
        // position down to a coarse bucket, so asking for 0:03 and being given
        // the start is the request being honoured, not ignored — warning there
        // taught the viewer to distrust a player that was working correctly.
        const seekGap = seekTargetRef.current === null
            ? 0
            : seekTargetRef.current - sessionStartAt;
        if (seekTargetRef.current !== null && seekGap > 30 && !(sessionStartAt > 0)
            && src.includes('/api/playback/hls/')) {
            showSyncToast(seekStartSupported
                ? `Máy chủ mở luồng từ đầu thay vì ${formatTime(seekTargetRef.current)} — hãy restart backend rồi tua lại`
                : `Đang dựng phim từ đầu — tới ${formatTime(seekTargetRef.current)} sẽ xem được, chờ một lát`);
        }
        clearSeekLock();

        const isHlsSrc = /\.m3u8(\?|#|$)/i.test(src);

        // This effect re-runs on src/token changes and tears down the old player.
        // A play() promise still pending at that moment rejects with AbortError
        // ("interrupted by a new load request"), so ignore results once stale.
        let cancelled = false;
        // Resume-coverage timeout holder: cleared if the pipeline tears down
        // before the playlist reports how much of the film it covers yet.
        let resumeTimer: ReturnType<typeof setTimeout> | undefined;

        const startPlayback = () => {
            if (cancelled) return;
            // A rebuild of a player the viewer had paused (recovery after a
            // dead session, a seek made while paused) stays paused instead of
            // shouting over whatever they switched to. Fresh mounts always
            // try: the tap-to-play prompt covers the blocked case.
            // userPausedRef is the latest intent (pause/play events);
            // pausedBeforeRebuildRef backs it up at teardown. Either saying
            // "paused" wins: an unwanted autoplay is far worse than a
            // stay-paused that one tap reverses.
            // The explicit pause() below is belt and suspenders: it also
            // settles any play request that slipped in around the teardown
            // (pause on an already-paused element is a silent no-op).
            if (!shouldAutoplayAfterRebuild(hasPlayedRef.current, pausedBeforeRebuildRef.current) || userPausedRef.current) {
                setIsPlaying(false);
                try {
                    video.pause();
                } catch {
                    // Already paused or not yet loadable: nothing to settle.
                }
                return;
            }
            // Audible-only start. By the time the async resolve (TorBox +
            // manifest) finishes, the click that opened the film is no longer
            // an active browser gesture, so audible play() rejects with
            // NotAllowedError. There is deliberately no muted fallback: a
            // paused first frame with a tap-to-play prompt beats silent video,
            // and the tap itself is a gesture, so play() then succeeds audible.
            video.muted = false;
            void video.play().then(
                () => {
                    if (cancelled) return;
                    // Believe the element, not the request: a pause that won
                    // the race after play() was issued must keep the UI paused.
                    setIsPlaying(!video.paused);
                    setAutoplayBlocked(false);
                },
                (err: unknown) => {
                    if (cancelled) return;
                    // Tear-down mid-flight (src change / reloadKey): ignore.
                    if (err instanceof DOMException && err.name === 'AbortError') return;
                    setIsPlaying(false);
                    if (err instanceof DOMException && err.name === 'NotAllowedError') {
                        setAutoplayBlocked(true);
                    }
                },
            );
        };

        const restoreProgress = () => {
            const saved = history.find(h => h.slug === movie.slug);
            const duration = durationSeconds || (Number.isFinite(video.duration) ? video.duration : 0);
            if (saved && saved.currentEpisode === episode.slug && saved.progress) {
                // Back off 2s so a reload never lands on the exact broken fragment.
                const resumeAt = Math.max(0, saved.progress - 2);
                video.currentTime = duration > 0 ? Math.min(resumeAt, Math.max(duration - 5, 0)) : resumeAt;
            }
        };

        if (!isHlsSrc) {
            video.src = src;
            const onLoaded = () => {
                restoreProgress();
                startPlayback();
                setIsLoading(false);
            };
            const onSrcError = () => {
                setIsLoading(false);
                const reason = 'Liên kết phát trực tiếp bị gián đoạn.';
                if (onPlaybackFailure) onPlaybackFailure(reason);
                else setError(`${reason} Bấm Thử lại để nối lại.`);
            };
            video.addEventListener('loadedmetadata', onLoaded);
            video.addEventListener('error', onSrcError);
            return () => {
                cancelled = true;
                video.removeEventListener('loadedmetadata', onLoaded);
                video.removeEventListener('error', onSrcError);
            };
        }

        if (Hls.isSupported()) {
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                // Keep a healthy cushion for a remote remux whose download
                // speed can fluctuate, while retaining only one minute behind.
                maxBufferLength: 90,
                maxMaxBufferLength: 180,
                backBufferLength: 60,
                startFragPrefetch: true,
                manifestLoadingMaxRetry: 4,
                manifestLoadingRetryDelay: 1000,
                manifestLoadingMaxRetryTimeout: 8000,
                fragLoadingTimeOut: 30000,
                fragLoadingMaxRetry: 6,
                fragLoadingRetryDelay: 1000,
                fragLoadingMaxRetryTimeout: 10000,
                // Our HLS endpoint is auth-protected per session owner.
                xhrSetup: (xhr, url) => {
                    if (authToken && url.includes('/api/playback/hls/')) {
                        xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
                    }
                },
            });
            hlsRef.current = hls;
            let fatalNetworkRecoveries = 0;
            let fatalMediaRecoveries = 0;
            // Same-fragment failure streak: a segment the server can never
            // serve (evicted session files read as 404, which hls.js tolerates
            // forever on a live playlist) otherwise spins forever with no
            // fatal error, no recovery and no message. Any loaded fragment
            // proves progress and resets the streak.
            let stuckFragSn: number | null = null;
            let stuckFragCount = 0;

            hls.loadSource(src);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                // Quality is picked upstream (source picker), so the player
                // always stays on Auto here.
                hls.currentLevel = -1;

                // Restore history (back off 2s to skip the exact stalled fragment).
                // Seek-started sessions skip this: their truncated timeline
                // begins at the target, so position 0 already IS the resume
                // point and history would yank playback backwards.
                const saved = history.find(h => h.slug === movie.slug);
                const resumeAt = (sessionStartAt > 0 || !(saved && saved.currentEpisode === episode.slug))
                    ? null
                    : computeResumeAt(
                        saved.progress,
                        durationSeconds || (Number.isFinite(video.duration) ? video.duration : 0),
                    );
                if (resumeAt === null) {
                    startPlayback();
                    setIsLoading(false);
                    return;
                }

                // A fresh remux only covers its written prefix: restoring
                // blindly past it makes hls.js snap back to ~0 ("pause a
                // while -> restarts from the beginning"). Wait for the first
                // coverage report, then restore directly (covered), clamp
                // (finished shorter), or open a session beginning at the
                // target (still filling). Playback holds on the spinner until
                // the decision lands so no wrong first frame flashes.
                let pendingResume: number | null = resumeAt;
                const clearResumeTimer = () => {
                    if (resumeTimer !== undefined) {
                        clearTimeout(resumeTimer);
                        resumeTimer = undefined;
                    }
                };
                // Metadata-safe: assigning currentTime before the element has
                // metadata throws InvalidStateError, which used to abort this
                // handler before startPlayback() and strand the player at 0.
                const settleResumeAt = (target: number) => {
                    pendingResume = null;
                    clearResumeTimer();
                    const applyResume = () => {
                        try {
                            video.currentTime = target;
                        } catch {
                            // Metadata still not ready; the loadedmetadata
                            // retry below applies it as soon as it is.
                        }
                    };
                    // Belt and suspenders: apply now when metadata is already
                    // here, and always leave the one-shot retry for the case
                    // it is not (re-applying the same value is a no-op).
                    resumeListenerRef.current = applyResume;
                    video.addEventListener('loadedmetadata', applyResume, { once: true });
                    applyResume();
                    startPlayback();
                    setIsLoading(false);
                };
                hls.on(Hls.Events.LEVEL_UPDATED, (_event, data) => {
                    if (pendingResume === null) return;
                    const head = data?.details?.totalduration;
                    if (typeof head !== 'number' || !Number.isFinite(head)) return;
                    const plan = planResume({
                        resumeAt: pendingResume,
                        head,
                        finished: data.details?.live === false,
                        canSeekResolve: typeof onSeekToPosition === 'function',
                    });
                    if (plan.kind === 'none') {
                        pendingResume = null;
                        clearResumeTimer();
                        startPlayback();
                        setIsLoading(false);
                    } else if (plan.kind === 'seek-resolve') {
                        pendingResume = null;
                        clearResumeTimer();
                        // Hand off to the debounced seek-resolve flow
                        // (indicator + epoch guards). The spinner stays until
                        // the new pipeline arrives and rebuilds.
                        const resumeKey = `${movie.slug}|${episode.slug}|${plan.at}`;
                        if (resumeFiredKeyRef.current === resumeKey) {
                            // Already tried this exact resume this mount (the
                            // server answered from-start): play what's buffered
                            // instead of looping resolves forever.
                            startPlayback();
                            setIsLoading(false);
                        } else {
                            resumeFiredKeyRef.current = resumeKey;
                            beginSeekLock(plan.at);
                        }
                    } else {
                        settleResumeAt(plan.at);
                    }
                });
                // Coverage report never came: fall back to a direct restore
                // attempt rather than spinning forever.
                resumeTimer = setTimeout(() => {
                    if (pendingResume === null) return;
                    settleResumeAt(pendingResume);
                }, 8000);
            });

            hls.on(Hls.Events.FRAG_LOADED, () => {
                fatalNetworkRecoveries = 0;
                stuckFragSn = null;
                stuckFragCount = 0;
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
                const sn = typeof data?.frag?.sn === 'number' ? data.frag.sn : null;
                if (!data.fatal && sn !== null && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    if (stuckFragSn === sn) stuckFragCount += 1;
                    else { stuckFragSn = sn; stuckFragCount = 1; }
                    if (stuckFragCount >= 8) {
                        stuckFragSn = null;
                        stuckFragCount = 0;
                        const reason = 'Đoạn video hiện tại không còn trên server (bản dựng đã bị dọn). Đang tạo lại luồng…';
                        if (onPlaybackFailure) onPlaybackFailure(reason);
                        else setError(`${reason} Bấm Thử lại để nối lại.`);
                        hls.destroy();
                        return;
                    }
                }
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            fatalNetworkRecoveries += 1;
                            if (fatalNetworkRecoveries <= 2) {
                                hls.startLoad(video.currentTime || -1);
                            } else {
                                const reason = 'Máy chủ không còn cung cấp segment của luồng hiện tại.';
                                if (onPlaybackFailure) onPlaybackFailure(reason);
                                else setError(`${reason} Bấm Thử lại để nối lại.`);
                                hls.destroy();
                            }
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            fatalMediaRecoveries += 1;
                            if (fatalMediaRecoveries === 1) {
                                hls.recoverMediaError();
                            } else if (fatalMediaRecoveries === 2) {
                                hls.swapAudioCodec();
                                hls.recoverMediaError();
                            } else {
                                const reason = 'Trình duyệt không phục hồi được dữ liệu media.';
                                if (onPlaybackFailure) onPlaybackFailure(reason);
                                else setError(`${reason} Bấm Thử lại để nối lại.`);
                                hls.destroy();
                            }
                            break;
                        default:
                            setError("Không thể phát video này.");
                            hls.destroy();
                            break;
                    }
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS cannot set headers, so the token rides the query string
            // (the backend's media guard accepts ?access_token=).
            video.src =
                authToken && src.includes('/api/playback/hls/')
                    ? `${src}${src.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(authToken)}`
                    : src;
            video.addEventListener('loadedmetadata', () => {
                const saved = history.find(h => h.slug === movie.slug);
                if (saved && saved.currentEpisode === episode.slug && saved.progress) {
                    video.currentTime = Math.max(0, saved.progress - 2);
                }
                startPlayback();
                setIsLoading(false);
            });
        } else {
            setError("Trình duyệt không hỗ trợ HLS.");
        }

        return () => {
            cancelled = true;
            // Remember intent for the next pipeline: a paused teardown must
            // rebuild paused, a playing one may resume playing.
            pausedBeforeRebuildRef.current = video.paused;
            if (resumeTimer !== undefined) {
                clearTimeout(resumeTimer);
                resumeTimer = undefined;
            }
            if (resumeListenerRef.current) {
                video.removeEventListener('loadedmetadata', resumeListenerRef.current);
                resumeListenerRef.current = null;
            }
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [src, movie.slug, episode.slug, authToken, retryKey, reloadKey, onPlaybackFailure, seekStartSupported]);

    // History Saver
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const saveProgress = async (force = false) => {
            // Interval ticks skip paused elements (nothing changed), but
            // pause/pagehide callers pass force=true: the position at the
            // exact moment of pausing is what a later resume must restore.
            if ((video.paused || video.ended) && !force) return;

            const duration = durationSeconds || (Number.isFinite(video.duration) ? video.duration : 0);
            // Display position: element time plus the session's start offset
            // (seek-started sessions play truncated 0-based bytes).
            const displayNow = sessionStartAt + video.currentTime;
            const currentTime = duration > 0 ? Math.min(displayNow, Math.max(duration - 5, 0)) : displayNow;

            if (currentTime > 5) {
                // Local save
                addToHistory({
                    id: movie.slug,
                    slug: movie.slug,
                    name: movie.name,
                    origin_name: movie.origin_name,
                    quality: movie.quality,
                    poster_url: movie.poster_url,
                    timeSaved: Date.now(),
                    currentEpisode: episode.slug,
                    progress: currentTime,
                    duration
                });

                // API sync (fire and forget to avoid blocking)
                // Ideally we check session here, but VideoPlayer is a client component.
                // We can pass session status or check it.
                // Since VideoPlayer doesn't have session prop, let's assume we can fetch it or just try calling API 
                // and let interceptors handle auth (if valid token exists).
                // However, frequent API calls on every 5s might be heavy.
                // Let's debounce or use a different strategy? 
                // 5s is fine for simple heartbeat if users are not massive.
                // Better: only sync every 30s or on pause/end.

                // For now, let's rely on the fact that if auth cookie/token is there, api call works.
                // We will import watchHistoryAPI.
                try {
                    // We need to valid if we are logged in. 
                    // Checking localStorage 'token' or similar might be enough if we don't want to useSession hook here to avoid re-renders.
                    // But standard way is useSession.
                    // Let's import watchHistoryAPI at top.
                    await import('@/lib/api').then(({ watchHistoryAPI }) => {
                        watchHistoryAPI.add({
                            movieSlug: movie.slug,
                            movieData: {
                                name: movie.name,
                                originName: movie.origin_name,
                                posterUrl: movie.poster_url,
                                thumbUrl: movie.poster_url,
                                year: 2024
                            },
                            episode: episode.slug,
                            server: 'Vip', // Default or pass prop
                            currentTime
                        }).catch(() => { }); // Ignore errors silently
                    });
                } catch (e) {
                    // ignore
                }
            }
        };
        const interval = setInterval(saveProgress, 10000); // 10s interval for API sync balance
        // Pause, backgrounding and tab close must all persist the exact stop
        // point: without these, a dead-then-recovered session resumes from the
        // last 10s tick instead of where the viewer actually stopped.
        const saveNow = () => { void saveProgress(true); };
        document.addEventListener('visibilitychange', saveNow);
        window.addEventListener('pagehide', saveNow);
        saveProgressRef.current = saveProgress;
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', saveNow);
            window.removeEventListener('pagehide', saveNow);
            if (saveProgressRef.current === saveProgress) saveProgressRef.current = null;
        };
    }, [movie, episode, addToHistory]);

    // Event Listeners
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => {
            if (video.paused) setCurrentTime(video.currentTime);
            if (video.currentTime > lastProgressRef.current + 0.25) {
                localStallRecoveryRef.current = false;
                armStallTimer();
                if (onPlaybackProgress) onPlaybackProgress(sessionStartAt + video.currentTime);
            }
            if (video.buffered.length > 0) {
                const bufferedEnd = video.buffered.end(video.buffered.length - 1);
                // Display scale: element ranges are session-local, the bar is
                // full-film (seek-started sessions play a truncated tail).
                const base = durationSeconds || video.duration;
                if (base > 0) {
                    setBuffered(((sessionStartAt + bufferedEnd) / base) * 100);
                }
            }
        };

        const handleDurationChange = () => setDuration(pickDisplayDuration(video.duration, durationSeconds));
        const handlePlay = () => {
            hasPlayedRef.current = true;
            userPausedRef.current = false;
            setIsPlaying(true);
            setAutoplayBlocked(false);
            armStallTimer();
        };
        const handlePause = () => {
            userPausedRef.current = true;
            clearStallTimer();
            setIsPlaying(false);
            // Persist the exact stop point now: the 10s interval skips paused
            // elements, so without this a later recovery resumes up to 10s
            // behind where the viewer actually paused.
            void saveProgressRef.current?.(true);
        };
        const handleWaiting = () => {
            if (video.paused) return;
            armStallTimer();
            if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
            loadingTimeoutRef.current = setTimeout(() => {
                setIsLoading(true);
            }, 600);
        };
        const handlePlaying = () => {
            armStallTimer();
            if (loadingTimeoutRef.current) {
                clearTimeout(loadingTimeoutRef.current);
                loadingTimeoutRef.current = undefined;
            }
            setIsLoading(false);
        };
        const handleCanPlay = () => {
            armStallTimer();
            if (loadingTimeoutRef.current) {
                clearTimeout(loadingTimeoutRef.current);
                loadingTimeoutRef.current = undefined;
            }
            setIsLoading(false);
        };
        const handleEnded = () => {
            clearStallTimer();
            setIsPlaying(false);
            // if (onNextEpisode) onNextEpisode(); // Optional auto-next
        };

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('durationchange', handleDurationChange);
        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);
        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('canplay', handleCanPlay);
        video.addEventListener('ended', handleEnded);

        return () => {
            if (loadingTimeoutRef.current) {
                clearTimeout(loadingTimeoutRef.current);
                loadingTimeoutRef.current = undefined;
            }
            clearStallTimer();
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('durationchange', handleDurationChange);
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('canplay', handleCanPlay);
            video.removeEventListener('ended', handleEnded);
        }
    }, [onNextEpisode, durationSeconds, onPlaybackFailure, onPlaybackProgress, sessionStartAt]);

    // Decode-overload watchdog: caps report decodability, never speed. A slow
    // decoder lags every heavy title with audio permanently ahead of the
    // picture (and subs early against the late picture) while no stall timer
    // fires, because currentTime keeps advancing. Sample
    // getVideoPlaybackQuality every 5s of playing time; one report per
    // source — the parent steps down and rebuilds, which remounts this.
    //
    // Two guards against false positives (a wrong downgrade also persists
    // via the source pin, so this must be conservative):
    // - discontinuity: any waiting/seeking/emptied since the last sample
    //   means the drops are catch-up skips after a stall, not weak decode.
    // - buffer health: a starved buffer (<5s ahead) blames the network.
    // Only a healthy buffer with sustained drops, twice in a row, reports.
    const onDecodeOverloadRef = useRef(onDecodeOverload);
    onDecodeOverloadRef.current = onDecodeOverload;
    const decodeDiscontinuityRef = useRef(true);
    useEffect(() => {
        if (typeof onDecodeOverloadRef.current !== 'function') return;
        decodeDiscontinuityRef.current = true;
        let prev: { decoded: number; dropped: number } | null = null;
        let badStreak = 0;
        let fired = false;
        const markDiscontinuity = () => {
            decodeDiscontinuityRef.current = true;
        };
        const v0 = videoRef.current;
        v0?.addEventListener('waiting', markDiscontinuity);
        v0?.addEventListener('seeking', markDiscontinuity);
        v0?.addEventListener('emptied', markDiscontinuity);
        const id = setInterval(() => {
            if (fired) return;
            const v = videoRef.current;
            if (!v || v.paused || v.ended) return;
            if (decodeDiscontinuityRef.current) {
                decodeDiscontinuityRef.current = false;
                prev = null;
                badStreak = 0;
                return;
            }
            let bufAhead = Number.POSITIVE_INFINITY;
            try {
                const b = v.buffered;
                if (b && b.length > 0) bufAhead = b.end(b.length - 1) - v.currentTime;
            } catch {
                return;
            }
            if (!(bufAhead > 5)) {
                prev = null;
                badStreak = 0;
                return;
            }
            let q: { totalVideoFrames?: number; droppedVideoFrames?: number } | null = null;
            try {
                q = typeof v.getVideoPlaybackQuality === 'function' ? v.getVideoPlaybackQuality() : null;
            } catch {
                return;
            }
            if (!q) return;
            const next = {
                decoded: Number(q.totalVideoFrames) || 0,
                dropped: Number(q.droppedVideoFrames) || 0,
            };
            if (prev && shouldDowngradeForDropped(prev, next)) {
                badStreak += 1;
                if (badStreak >= 2) {
                    fired = true;
                    clearInterval(id);
                    onDecodeOverloadRef.current?.();
                    return;
                }
            } else {
                badStreak = 0;
            }
            prev = next;
            // 10s windows: shouldDowngradeForDropped needs ~240 decoded frames
            // (~10s of 24fps film) per window to judge; 5s windows at film
            // framerates could never reach the baseline and would never fire.
        }, 10000);
        return () => {
            clearInterval(id);
            v0?.removeEventListener('waiting', markDiscontinuity);
            v0?.removeEventListener('seeking', markDiscontinuity);
            v0?.removeEventListener('emptied', markDiscontinuity);
        };
    }, [src]);

    // Controls Visibility (touch taps reuse the same path: on touch
    // screens there is no mousemove, so without this the bar can never be
    // recalled once it auto-hides — especially in fullscreen).
    // The settings sheet pins the bar open while it is up.
    const showSettingsRef = useRef(false);
    showSettingsRef.current = showSettings;
    const handleMouseMove = () => {
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => {
            // Never auto-hide over a black frame: with no picture yet the
            // hidden bar reads as "the player disappeared". (hasPicture is
            // the value at mousemove time; erring toward visible is safe.)
            if (isPlaying && !showSettingsRef.current && hasPicture) setShowControls(false);
        }, 3000);
    };

    const togglePlay = useCallback(() => {
        if (videoRef.current) {
            // While a far seek is resolving, the element still holds the old
            // position: neither direction is allowed, or playback visibly
            // jumps (play starts stale footage, pause fights the incoming
            // pipeline). The overlay below offers Hủy instead.
            if (seekTargetRef.current !== null) {
                showSyncToast('Đang tải tới điểm tua — đợi chút nhé');
                return;
            }
            if (isPlaying) videoRef.current.pause();
            else videoRef.current.play();
        }
    }, [isPlaying, showSyncToast]);

    // Fullscreen state is owned by the browser (ESC key, system gestures and
    // the mobile system UI can enter/leave at any time), so React only
    // mirrors document.fullscreenElement instead of guessing optimistically.
    // That stale optimistic set is what used to leave the player showing the
    // wrong icon — or a hidden bar — after exiting fullscreen outside the button.
    useEffect(() => {
        const syncFullscreen = () => {
            const el = document.fullscreenElement;
            const target = fullscreenTargetRef?.current ?? containerRef.current;
            setIsFullscreen(!!el && el === target);
        };
        document.addEventListener('fullscreenchange', syncFullscreen);
        return () => document.removeEventListener('fullscreenchange', syncFullscreen);
    }, [fullscreenTargetRef]);

    const toggleFullscreen = useCallback(() => {
        const container = fullscreenTargetRef?.current ?? containerRef.current;
        if (!document.fullscreenElement) {
            if (container?.requestFullscreen) {
                try {
                    const p = container.requestFullscreen() as unknown as Promise<void> | undefined;
                    // Rejection (denied gesture, ESC race) is fine: the
                    // fullscreenchange listener above keeps state honest.
                    p?.catch(() => {});
                } catch {
                    // Older iOS Safari throws synchronously: fall through.
                    (videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void } | null)?.webkitEnterFullscreen?.();
                }
            } else {
                // iOS Safari has no element fullscreen at all.
                (videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void } | null)?.webkitEnterFullscreen?.();
            }
        } else if (document.exitFullscreen) {
            try {
                const p = document.exitFullscreen() as unknown as Promise<void> | undefined;
                p?.catch(() => {});
            } catch { /* already exiting */ }
        }
    }, [fullscreenTargetRef]);

    // Toggle Picture-in-Picture
    const togglePiP = async () => {
        if (!videoRef.current) return;
        
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                setIsPiP(false);
            } else {
                await videoRef.current.requestPictureInPicture();
                setIsPiP(true);
            }
        } catch (err) {
            console.error('PiP error:', err);
        }
    };

    // Keep PiP state in sync with browser events, but do not auto-enter PiP on tab changes.
    useEffect(() => {
        // Listen for PiP events
        const handleEnterPiP = () => {
            setIsPiP(true);
        };
        const handleLeavePiP = () => {
            setIsPiP(false);
        };

        videoRef.current?.addEventListener('enterpictureinpicture', handleEnterPiP);
        videoRef.current?.addEventListener('leavepictureinpicture', handleLeavePiP);

        return () => {
            videoRef.current?.removeEventListener('enterpictureinpicture', handleEnterPiP);
            videoRef.current?.removeEventListener('leavepictureinpicture', handleLeavePiP);
        };
    }, [isPlaying]);

    // Written head of the HLS playlist (seconds). While a remux is still
    // filling, only this prefix exists server-side; NaN when unknown
    // (level not loaded yet, or a native progressive file).
    const playlistHeadEnd = (): number => {
        const hls = hlsRef.current;
        if (!hls || !Array.isArray(hls.levels) || hls.levels.length === 0) return NaN;
        const active = hls.levels[hls.autoLevelEnabled ? hls.loadLevel : hls.currentLevel]
            ?? hls.levels[hls.currentLevel];
        const total = active?.details?.totalduration;
        return typeof total === 'number' ? total : NaN;
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = Number(e.target.value);
        const video = videoRef.current;
        if (!video) return;
        // Targets inside the written window play instantly; targets outside
        // ask the server for a session beginning there instead of stalling on
        // segments that do not exist yet. Without a re-resolve path (direct
        // files) the target clamps to the newest watchable point.
        const decision = decideSeekTarget({
            target: raw,
            startAt: sessionStartAt,
            headLocal: playlistHeadEnd(),
            canReresolve: typeof onSeekToPosition === 'function',
        });
        if (decision.kind === 'reresolve') {
            // Hard-lock the old pipeline immediately: the current element is
            // still showing stale media, so pause it now and keep a blocking
            // overlay until the new seek-started session arrives or is
            // cancelled. Re-targeting cancels the old request and replaces it.
            if (seekTargetRef.current !== null && seekTargetRef.current !== decision.at) {
                onCancelSeek?.();
                seekFiredEpochRef.current += 1;
            }
            beginSeekLock(decision.at);
            return;
        }
        // A direct seek supersedes any pending seek-resolve: invalidate it so
        // its late response cannot yank playback to an abandoned position.
        if (seekTargetRef.current !== null) {
            onCancelSeek?.();
            clearSeekLock();
        }
        if (decision.clamped && raw > 1) {
            showSyncToast('Đoạn này phim chưa tải tới — đã đưa tới chỗ mới nhất xem được');
        }
        try {
            video.currentTime = decision.localTime;
        } catch {
            // Metadata not ready yet; the element applies it on load.
        }
        setCurrentTime(decision.localTime);
    };

    // Tap-friendly ±10s seek shared by buttons, keyboard and gestures.
    // Routes through decideSeekTarget so remux sessions past the written head
    // trigger a server re-resolve instead of stalling on missing segments.
    const seekBy = useCallback((deltaSeconds: number) => {
        const video = videoRef.current;
        if (!video) return;
        if (seekTargetRef.current !== null) {
            showSyncToast('Đang tải tới điểm tua — đợi chút nhé');
            return;
        }
        const max = fullDuration > 0 ? fullDuration : Number.POSITIVE_INFINITY;
        const rawTarget = displayTime + deltaSeconds;
        const raw = Number.isFinite(max)
            ? Math.min(Math.max(rawTarget, 0), Math.max(max - 0.5, 0))
            : Math.max(rawTarget, 0);
        const decision = decideSeekTarget({
            target: raw,
            startAt: sessionStartAt,
            headLocal: playlistHeadEnd(),
            canReresolve: typeof onSeekToPosition === 'function',
        });
        if (decision.kind === 'reresolve') {
            beginSeekLock(decision.at);
            handleMouseMove();
            return;
        }
        if (decision.clamped && Math.abs(raw - displayTime) > 1) {
            showSyncToast('Đoạn này phim chưa tải tới — đã đưa tới chỗ mới nhất xem được');
        }
        try {
            video.currentTime = decision.localTime;
        } catch {
            // Metadata not ready yet; the element applies it on load.
        }
        setCurrentTime(decision.localTime);
        handleMouseMove();
    }, [displayTime, fullDuration, sessionStartAt, onSeekToPosition, showSyncToast, handleMouseMove]);

    // In-flight far-seek target (display seconds). Set per scrub tick, fired
    // debounced: without this, one drag spawns a resolve (and an ffmpeg)
    // per tick and sessions pile up faster than the server reaps them.
    // (State + epoch refs live near the top refs; togglePlay reads them.)
    useEffect(() => {
        if (seekTarget === null || typeof onSeekToPosition !== 'function') return;
        const at = seekTarget;
        const timer = setTimeout(() => {
            const epoch = ++seekFireEpochRef.current;
            seekFiredEpochRef.current = epoch;
            showSyncToast(`Đang tải phim từ ${formatTime(at)}…`);
            if (typeof window !== 'undefined') {
                console.debug(`[seek] resolve startAt=${at}s epoch=${epoch}`);
            }
            void Promise.resolve()
                .then(() => onSeekToPosition(at))
                .catch((err: unknown) => {
                    // Resolve failed and no newer seek superseded it: drop the
                    // indicator and say why over the still-playing picture
                    // instead of failing blind (the old segment keeps running).
                    if (seekFiredEpochRef.current === epoch) {
                        clearSeekLock();
                        const reason = err instanceof Error && err.message
                            ? err.message.slice(0, 140)
                            : 'không rõ nguyên nhân';
                        showSyncToast(`Không tua được: ${reason}`);
                        if (typeof window !== 'undefined') {
                            console.warn(`[seek] resolve startAt=${at}s failed:`, reason);
                        }
                    }
                });
        }, 650);
        return () => clearTimeout(timer);
    }, [seekTarget, onSeekToPosition]);

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const vol = Number(e.target.value);
        setVolume(vol);
        if (videoRef.current) {
            videoRef.current.volume = vol;
            // The element stays muted until told otherwise: dragging the slider
            // up must also clear muted, otherwise sound can never come back
            // that way (volume up + muted element = silence).
            videoRef.current.muted = vol === 0;
            setIsMuted(vol === 0);
        }
    };

    // Shared pill styling for the volume sliders (desktop hover bar + touch
    // bar): glossy amber fill up to the current level, glass beyond it.
    const volPct = Math.round((isMuted ? 0 : volume) * 100);
    const volTrackBg =
        `linear-gradient(to bottom, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 55%), ` +
        `linear-gradient(to right, #b45309 0%, #f59e0b ${volPct}%, rgba(255,255,255,0.22) ${volPct}%)`;

    const toggleMute = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            // Speaker on a paused player means "play with sound", not "flip
            // the mute flag on a frozen frame": a paused player is silent
            // either way, so unmute and start audible playback (this tap is a
            // gesture, so play() is allowed). Slider-to-zero still mutes.
            video.muted = false;
            setIsMuted(false);
            if (video.volume === 0) video.volume = 1;
            setVolume(video.volume || 1);
            void video.play().catch(() => { /* errors surface via events */ });
            return;
        }
        // Read the element, not React state: the 'M' shortcut handler closes
        // over a stale isMuted. The element is the source of truth.
        const newMuted = !video.muted;
        video.muted = newMuted;
        setIsMuted(newMuted);
        if (newMuted) {
            setVolume(0);
        } else {
            if (video.volume === 0) video.volume = 1;
            setVolume(video.volume);
            // Unmuting is a real user gesture, so audible playback is allowed
            // now. Guarantee the picture keeps moving with the sound on instead
            // of sitting paused at the same frame.
            void video.play().catch(() => { /* errors surface via events */ });
        }
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

            switch (e.key.toLowerCase()) {
                case ' ':
                case 'k':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'f':
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case 'arrowright':
                    e.preventDefault();
                    seekBy(10);
                    break;
                case 'arrowleft':
                    e.preventDefault();
                    seekBy(-10);
                    break;
                case 'm':
                    toggleMute();
                    break;
                case 'i':
                    e.preventDefault();
                    togglePiP();
                    break;
                case 'g':
                    e.preventDefault();
                    adjustSubDelay(-0.1);
                    break;
                case 'h':
                    e.preventDefault();
                    adjustSubDelay(0.1);
                    break;
                case '[':
                    e.preventDefault();
                    adjustSecondaryOffset(-0.5);
                    break;
                case ']':
                    e.preventDefault();
                    adjustSecondaryOffset(0.5);
                    break;
                case '?':
                    e.preventDefault();
                    setShowKeyboardHelp(true);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [togglePlay, toggleFullscreen, adjustSubDelay, adjustSecondaryOffset, seekBy]);

    if (error) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-surface-light border border-wine-accent/40 rounded-lg">
                <div className="text-center">
                    <p className="text-amber-gold font-bold mb-2">Đã có lỗi xảy ra</p>
                    <p className="text-cinema-subtle text-sm">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full bg-black group overflow-hidden select-none"
            onMouseMove={handleMouseMove}
            // Touch screens never fire mousemove: taps must recall the bar too.
            onTouchStart={handleMouseMove}
            onMouseLeave={() => isPlaying && !showSettings && hasPicture && setShowControls(false)}
            onClick={togglePlay}
            onDoubleClick={toggleFullscreen}
        >
            {/* Keyboard Shortcuts Help Modal */}
            {showKeyboardHelp && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setShowKeyboardHelp(false)}>
                    <div className="bg-surface-light rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl border border-white/10" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-white text-xl font-bold flex items-center gap-2">
                                <span>⌨️</span>
                                Phím tắt
                            </h3>
                            <button onClick={() => setShowKeyboardHelp(false)} className="text-cinema-subtle hover:text-white transition">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        
                        <div className="space-y-3">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-cinema-muted">Play / Pause</span>
                                <div className="flex gap-2">
                                    <kbd className="bg-white/10 px-3 py-1 rounded text-white">Space</kbd>
                                    <kbd className="bg-white/10 px-3 py-1 rounded text-white">K</kbd>
                                </div>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-cinema-muted">Toàn màn hình</span>
                                <kbd className="bg-white/10 px-3 py-1 rounded text-white">F</kbd>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-cinema-muted">Picture-in-Picture</span>
                                <kbd className="bg-white/10 px-3 py-1 rounded text-white">I</kbd>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-cinema-muted">Tắt / Bật âm</span>
                                <kbd className="bg-white/10 px-3 py-1 rounded text-white">M</kbd>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-cinema-muted">Tua 10s</span>
                                <kbd className="bg-white/10 px-3 py-1 rounded text-white">→</kbd>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-cinema-muted">Lùi 10s</span>
                                <kbd className="bg-white/10 px-3 py-1 rounded text-white">←</kbd>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-cinema-muted">Chậm phụ đề 0.5s</span>
                                <kbd className="bg-white/10 px-3 py-1 rounded text-white">G</kbd>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-cinema-muted">Nhanh phụ đề 0.5s</span>
                                <kbd className="bg-white/10 px-3 py-1 rounded text-white">H</kbd>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-cinema-muted">Lùi phụ đề 2 (0.5s)</span>
                                <kbd className="bg-white/10 px-3 py-1 rounded text-white">[</kbd>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-cinema-muted">Tiến phụ đề 2 (0.5s)</span>
                                <kbd className="bg-white/10 px-3 py-1 rounded text-white">]</kbd>
                            </div>
                        </div>
                        
                        <div className="mt-6 text-center">
                            <button onClick={() => setShowKeyboardHelp(false)} className="bg-amber-primary hover:bg-amber-600 text-white px-6 py-2 rounded-full font-semibold transition">
                                Đóng
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Subtitle Sync Toast */}
            {syncToast && (
                <div className="pointer-events-none absolute top-12 left-1/2 -translate-x-1/2 z-40 rounded-full bg-black/85 backdrop-blur-md px-4 py-1.5 text-xs font-semibold text-amber-gold border border-amber-primary/40 shadow-xl transition-all">
                    {syncToast}
                </div>
            )}

            {/* Keyboard Help Hint (desktop only: no keyboard on touch) */}
            <div className={`hidden sm:block absolute top-4 right-4 z-20 liquid-glass rounded-lg px-3 py-1.5 text-white text-xs transition-opacity ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                <button onClick={(e) => { e.stopPropagation(); setShowKeyboardHelp(true); }} className="hover:text-amber-gold transition">
                    Press <kbd className="bg-white/20 px-1.5 py-0.5 rounded mx-1">?</kbd> for shortcuts
                </button>
            </div>

            {/* Poster backdrop while no picture yet: a titled poster over black
                reads as "loading the film", a bare black frame reads as
                "the player is gone". Removed on the first real frame. */}
            {!hasPicture && movie.poster_url && (
                <img
                    src={movie.poster_url}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40"
                />
            )}
            <video
                ref={videoRef}
                className={`w-full h-full ${videoScale === 'cover' ? 'object-cover' : videoScale === 'fill' ? 'object-fill' : 'object-contain'}`}
                playsInline
                onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                onDoubleClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
            />

            {/* Loading Spinner */}
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20 backdrop-blur-sm">
                    <Loader2 className="w-12 h-12 text-amber-gold animate-spin" />
                </div>
            )}

            {/* Far-seek indicator: a BLOCKING overlay over the whole player.
                While it is up the element still holds the old position, so
                every control beneath is unreachable (play/pause are locked in
                togglePlay too) — the viewer waits instead of mashing inputs
                that would spawn competing resolves. The Hủy button abandons
                the seek: the in-flight resolve's late response is dropped by
                epoch and the old picture simply continues. */}
            {seekTarget !== null && !isLoading && (
                <div className="absolute inset-0 z-30 flex items-start justify-center bg-black/55 pt-16 backdrop-blur-[2px]">
                    <div className="liquid-glass-strong flex items-center gap-3 rounded-2xl px-4 py-3">
                        <Loader2 className="w-6 h-6 shrink-0 text-amber-gold animate-spin" />
                        <div className="text-left">
                            <p className="text-sm font-bold text-white">
                                Đang tải phim từ {formatTime(seekTarget)}…
                            </p>
                            <p className="text-[11px] text-cinema-muted">
                                {seekProgress?.label || 'Vui lòng đợi trong giây lát'}
                            </p>
                            {typeof seekProgress?.percent === 'number' && seekProgress.percent > 0 && (
                                <div className="mt-1.5 h-1 w-44 overflow-hidden rounded-full bg-white/15">
                                    <div
                                        className="h-full rounded-full bg-amber-primary transition-all duration-500"
                                        style={{ width: `${Math.min(99, Math.max(1, seekProgress.percent))}%` }}
                                    />
                                </div>
                            )}
                        </div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onCancelSeek?.();
                                clearSeekLock();
                            }}
                            className="liquid-glass-btn ml-1 shrink-0 rounded-full px-3 py-1.5 text-xs font-bold text-white"
                        >
                            Hủy
                        </button>
                    </div>
                </div>
            )}

            {/* Big Play Button (when paused). Hidden while a far seek resolves:
                the element still holds the old position, so offering play
                would start stale footage for a second. Clicks fall through to
                the container's togglePlay, so one tap starts audible playback.
                Autoplay-blocked is the exception: play() was refused for lack
                of gesture, so no frame will ever arrive and isLoading never
                clears — without this carve-out the viewer stares at an eternal
                spinner with no hint that one tap fixes it. */}
            {!isPlaying && (!isLoading || autoplayBlocked) && seekTarget === null && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 cursor-pointer">
                    <div className="flex items-center justify-center gap-6 sm:gap-8">
                        {/* Mobile quick-seek flanking the big play: thumb-friendly */}
                        <button
                            onClick={(e) => { e.stopPropagation(); seekBy(-10); }}
                            aria-label="Lùi 10 giây"
                            className="sm:hidden relative flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md border border-white/20 active:scale-90 touch-manipulation"
                            style={{ minWidth: 56, minHeight: 56 }}
                        >
                            <RotateCcw className="w-6 h-6" />
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center pt-[2px] text-[9px] font-bold leading-none">10</span>
                        </button>
                        <div className="w-20 h-20 liquid-glass liquid-play rounded-full flex items-center justify-center pl-2 group-hover:scale-110 transition-transform duration-300">
                            <Play className="text-white w-10 h-10 fill-white" />
                        </div>
                        <button
                            onClick={(e) => { e.stopPropagation(); seekBy(10); }}
                            aria-label="Tua tới 10 giây"
                            className="sm:hidden relative flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md border border-white/20 active:scale-90 touch-manipulation"
                            style={{ minWidth: 56, minHeight: 56 }}
                        >
                            <RotateCw className="w-6 h-6" />
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center pt-[2px] text-[9px] font-bold leading-none">10</span>
                        </button>
                    </div>
                    {autoplayBlocked && (
                        <p className="rounded-full bg-black/70 backdrop-blur-md px-4 py-1.5 text-xs font-semibold text-amber-gold border border-amber-primary/40">
                            Nhấn để phát có tiếng
                        </p>
                    )}
                </div>
            )}

            {/* Mobile side quick-seek while playing: large tap targets at mid-height.
                Shown only on touch layouts when controls are visible so playback
                keeps running underneath. */}
            {isPlaying && !isLoading && seekTarget === null && showControls && (
                <div className="sm:hidden pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 z-10 flex items-center justify-between">
                    <button
                        onClick={(e) => { e.stopPropagation(); seekBy(-10); }}
                        aria-label="Lùi 10 giây"
                        className="pointer-events-auto relative flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md border border-white/20 active:scale-90 touch-manipulation"
                        style={{ minWidth: 48, minHeight: 48 }}
                    >
                        <RotateCcw className="w-5 h-5" />
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center pt-[2px] text-[8px] font-bold leading-none">10</span>
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); seekBy(10); }}
                        aria-label="Tua tới 10 giây"
                        className="pointer-events-auto relative flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md border border-white/20 active:scale-90 touch-manipulation"
                        style={{ minWidth: 48, minHeight: 48 }}
                    >
                        <RotateCw className="w-5 h-5" />
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center pt-[2px] text-[8px] font-bold leading-none">10</span>
                    </button>
                </div>
            )}

            {/* Custom subtitle overlay (single + bilingual). Rendered by hand
                instead of native <track> so cross-origin VTT needs no CORS
                changes on the media itself and two languages can show at once. */}
            {(primaryCues.length > 0 || secondaryCues.length > 0) && (
                <div className="pointer-events-none absolute inset-x-0 bottom-32 sm:bottom-28 z-20 flex flex-col items-center gap-1.5 px-6 text-center">
                    {secondaryCues.map((cue, i) => (
                        <p
                            key={`sec-${cue.start}-${i}`}
                            className="max-w-3xl whitespace-pre-line rounded-md bg-black/55 px-3 py-1 font-medium opacity-90"
                            style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)', fontSize: Math.round(subSize * 0.8), color: subColor }}
                        >
                            {cue.text}
                        </p>
                    ))}
                    {primaryCues.map((cue, i) => (
                        <p
                            key={`pri-${cue.start}-${i}`}
                            className="max-w-3xl whitespace-pre-line rounded-md bg-black/65 px-4 py-1.5 font-semibold"
                            style={{ textShadow: '0 2px 4px rgba(0,0,0,0.9)', fontSize: subSize, color: subColor }}
                        >
                            {cue.text}
                        </p>
                    ))}
                </div>
            )}

            {/* Controls Overlay — floating liquid-glass pill. When hidden it
                must also drop pointer events, otherwise the invisible bar
                swallows taps on the bottom of the video (notably in
                fullscreen) and the player feels "stuck". */}
            <div
                className={`absolute inset-x-2 bottom-2 sm:inset-x-4 sm:bottom-4 z-30 liquid-glass rounded-2xl px-3 pt-2.5 pb-2.5 sm:px-4 transition-all duration-300 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'}`}
                onClick={(e) => e.stopPropagation()}
                // Double-clicks on controls (e.g. the settings gear) must not
                // bubble to the container's onDoubleClick (= fullscreen).
                onDoubleClick={(e) => e.stopPropagation()}
            >
                {/* Progress Bar (taller invisible hit area for touch).
                    The track thickens on hover/active and stays vertically
                    centered, so it feels like YouTube's seek bar. */}
                <div className="relative w-full h-6 -mt-1 cursor-pointer mb-1 flex items-center group/progress">
                    <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full group-hover/progress:h-3 group-active/progress:h-3 transition-all duration-200">
                        <div className="absolute top-0 left-0 h-full w-full bg-white/20 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-white/40"
                                style={{ width: `${buffered}%` }}
                            />
                        </div>
                    <div
                        className="absolute top-0 left-0 h-full liquid-track-played rounded-full transition-all duration-200"
                        style={{ width: `${fullDuration > 0 ? (displayTime / fullDuration) * 100 : 0}%` }}
                    />
                    </div>
                    {/* Draggable Knob */}
                    <div
                        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 liquid-knob rounded-full scale-[0.55] group-hover/progress:scale-110 group-active/progress:scale-110 transition-all duration-200 pointer-events-none"
                        style={{ left: `calc(${fullDuration > 0 ? (displayTime / fullDuration) * 100 : 0}% - 8px)` }}
                    />
                    <input
                        type="range"
                        min={0}
                        max={fullDuration || 100}
                        step="0.1"
                        value={displayTime}
                        onChange={handleSeek}
                        aria-label="Tua video"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                </div>

                <div className="flex items-center justify-between gap-1.5 sm:gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-3">
                        <button onClick={togglePlay} aria-label={isPlaying ? 'Tạm dừng' : 'Phát'} className="liquid-glass-btn shrink-0 text-white hover:text-amber-gold transition-colors p-1.5 sm:p-2 rounded-full">
                            {isPlaying ? <Pause className="w-6 h-6 sm:w-7 sm:h-7" fill="currentColor" /> : <Play className="w-6 h-6 sm:w-7 sm:h-7" fill="currentColor" />}
                        </button>

                        {/* ±10s seek: desktop/tablet (mobile uses center/side overlay buttons) */}
                        <button
                            onClick={(e) => { e.stopPropagation(); seekBy(-10); }}
                            aria-label="Lùi 10 giây"
                            title="Lùi 10s"
                            className="liquid-glass-btn relative hidden sm:inline-flex shrink-0 text-white hover:text-amber-gold transition-colors p-2 rounded-full active:scale-90 touch-manipulation"
                            style={{ minWidth: 44, minHeight: 44 }}
                        >
                            <RotateCcw className="w-5 h-5 sm:w-6 sm:h-6" />
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center pt-[2px] text-[8px] font-bold leading-none">10</span>
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); seekBy(10); }}
                            aria-label="Tua tới 10 giây"
                            title="Tua 10s"
                            className="liquid-glass-btn relative hidden sm:inline-flex shrink-0 text-white hover:text-amber-gold transition-colors p-2 rounded-full active:scale-90 touch-manipulation"
                            style={{ minWidth: 44, minHeight: 44 }}
                        >
                            <RotateCw className="w-5 h-5 sm:w-6 sm:h-6" />
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center pt-[2px] text-[8px] font-bold leading-none">10</span>
                        </button>

                        {/* Hover slider is desktop-only: touch has hardware buttons */}
                        <div className="hidden sm:flex items-center gap-2 group/volume relative">
                            <button onClick={toggleMute} aria-label={isMuted ? 'Bật tiếng' : 'Tắt tiếng'} className="liquid-glass-btn text-white hover:text-cinema-muted transition-all p-2 rounded-full active:scale-90">
                                {isMuted || volume === 0 ? <VolumeX size={22} /> : volume < 0.5 ? <Volume1 size={22} /> : <Volume2 size={22} />}
                            </button>
                            {/* Volume % bubble: floats over the expanded slider */}
                            <span className="pointer-events-none absolute -top-8 left-[94px] -translate-x-1/2 whitespace-nowrap rounded-md border border-amber-primary/40 bg-black/80 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-gold opacity-0 shadow-lg transition-opacity duration-200 group-hover/volume:opacity-100">
                                {volPct}
                            </span>
                            <div className="w-0 overflow-hidden group-hover/volume:w-24 group-focus-within/volume:w-24 transition-all duration-300 flex items-center">
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={isMuted ? 0 : volume}
                                    onChange={handleVolumeChange}
                                    aria-label="Âm lượng"
                                    style={{ background: volTrackBg }}
                                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer active:cursor-grabbing liquid-range focus-visible:ring-2 focus-visible:ring-amber-primary/60"
                                />
                            </div>
                        </div>

                        {/* Mobile quick mute button (no slider taking 64px and overflowing) */}
                        <button
                            onClick={toggleMute}
                            aria-label={isMuted ? 'Bật tiếng' : 'Tắt tiếng'}
                            className="liquid-glass-btn sm:hidden shrink-0 text-white hover:text-cinema-muted transition-all p-1.5 rounded-full active:scale-90"
                        >
                            {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : volume < 0.5 ? <Volume1 className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                        </button>

                        <div className="liquid-divider mx-1 hidden sm:block" />

                        <div className="shrink-0 whitespace-nowrap text-xs sm:text-sm font-medium text-cinema-muted font-mono tracking-wider liquid-chip px-2 sm:px-2.5 py-0.5 sm:py-1">
                            {formatTime(displayTime)} / {formatTime(fullDuration)}
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1 sm:gap-3">
                        {onNextEpisode && (
                            <button
                                onClick={onNextEpisode}
                                className="flex items-center gap-1.5 bg-amber-primary/90 hover:bg-amber-primary text-black text-sm px-2.5 sm:px-4 py-1.5 rounded-xl backdrop-blur-sm transition-all border border-amber-primary/50 shadow-[0_0_20px_-5px_rgba(245,158,11,0.6)]"
                            >
                                <SkipForward size={16} fill="currentColor" />
                                <span className="hidden font-bold min-[420px]:inline"> Tập Tiếp</span>
                            </button>
                        )}

                        <div className="relative group/settings">
                            <button
                                onClick={toggleSettings}
                                aria-label="Cài đặt phát"
                                className={`liquid-glass-btn text-white transition-colors p-1.5 sm:p-2 rounded-full ${showSettings ? 'liquid-glass-btn-on' : ''}`}
                            >
                                <Settings className={`w-5 h-5 sm:w-[22px] sm:h-[22px] transition-transform duration-500 ease-out ${showSettings ? 'rotate-90' : 'group-hover/settings:rotate-45'}`} />
                            </button>

                            {/* Settings sheet: portalled to the player root so it
                                anchors to the player box itself. (A `fixed`
                                sheet nested under the glass pill would be
                                hijacked by the pill's backdrop-filter, which
                                becomes its containing block and sandwiches it
                                between the viewport top and the controls bar
                                on phones.) True bottom sheet on phones (scrim
                                + pinned header), floating card on larger
                                screens. Stays inside the fullscreen subtree. */}
                            {showSettings && containerRef.current && createPortal(
                                <>
                                    {/* Scrim (phones only): tap outside to close */}
                                    <div
                                        className="absolute inset-0 z-[60] bg-black/45 sm:hidden animate-in fade-in duration-200"
                                        onClick={(e) => { e.stopPropagation(); setShowSettings(false); }}
                                    />
                                    <div
                                        {...{ [CINEMA_BRIGHT_ATTR]: '' }}
                                        className="absolute inset-x-2 bottom-2 max-h-[calc(100%-1rem)] sm:inset-x-auto sm:right-4 sm:bottom-24 sm:w-[22rem] sm:max-h-[calc(100%-7.5rem)] overflow-hidden liquid-glass-strong liquid-glass-sheen rounded-2xl flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-200 z-[70]">
                                    <div className="flex shrink-0 justify-center pt-2.5 sm:hidden" aria-hidden="true">
                                        <div className="h-1 w-10 rounded-full bg-white/25" />
                                    </div>
                                    <h4 className="shrink-0 text-white font-bold text-sm border-b border-white/10 px-4 pt-2.5 sm:pt-3.5 pb-2.5 flex items-center gap-2">
                                        <span className="liquid-chip p-1.5 flex items-center justify-center">
                                            <Settings size={14} className="text-amber-gold" />
                                        </span>
                                        Cài đặt phát
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setShowSettings(false); }}
                                            aria-label="Đóng cài đặt"
                                            className="liquid-glass-btn ml-auto text-cinema-subtle hover:text-white p-1.5 rounded-full"
                                        >
                                            <X size={16} />
                                        </button>
                                    </h4>

                                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto custom-scrollbar px-4 py-3">
                                        {/* Speed Controller */}
                                        <div>
                                            <div className="flex justify-between items-center mb-2">
                                                <p className="text-xs text-cinema-subtle font-bold uppercase tracking-wider">Tốc độ</p>
                                                <span className="text-xs text-amber-gold font-bold">{playbackSpeed}x</span>
                                            </div>
                                            <div className="grid grid-cols-5 gap-1.5">
                                                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                                                    <button
                                                        key={speed}
                                                        onClick={() => changePlaybackSpeed(speed)}
                                                        className={`
                                                            px-1 py-1.5 rounded-md text-[10px] font-bold transition-all border
                                                            ${playbackSpeed === speed
                                                                ? 'bg-amber-primary text-black border-amber-primary shadow-lg shadow-amber-glow scale-105'
                                                                : 'bg-surface-container text-cinema-subtle border-white/10 hover:bg-surface-container-high hover:text-white hover:border-white/30'}
                                                        `}
                                                    >
                                                        {speed}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Video scale */}
                                        <div>
                                            <div className="flex justify-between items-center mb-2">
                                                <p className="text-xs text-cinema-subtle font-bold uppercase tracking-wider">Màn hình</p>
                                            </div>
                                            <div className="grid grid-cols-3 gap-1.5">
                                                {([
                                                    { id: 'contain', label: 'Vừa khung' },
                                                    { id: 'cover', label: 'Lấp đầy' },
                                                    { id: 'fill', label: 'Kéo giãn' },
                                                ] as const).map((m) => (
                                                    <button
                                                        key={m.id}
                                                        onClick={() => {
                                                            setVideoScale(m.id);
                                                            savePrefs({ scale: m.id, subSize, subColor });
                                                        }}
                                                        className={`px-2 py-1.5 rounded-md text-[10px] font-bold transition-all border ${videoScale === m.id
                                                            ? 'bg-amber-primary text-black border-amber-primary'
                                                            : 'bg-surface-container text-cinema-subtle border-white/10 hover:text-white'}`}
                                                    >
                                                        {m.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Background shader */}
                                        <div>
                                            <div className="flex justify-between items-center mb-2">
                                                <p className="text-xs text-cinema-subtle font-bold uppercase tracking-wider">Nền động</p>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    const next = !shaderOn;
                                                    setShaderOn(next);
                                                    setShaderEnabled(next);
                                                }}
                                                className={`w-full text-left px-2.5 py-2 rounded-md border transition-all ${shaderOn
                                                    ? 'bg-amber-primary/15 border-amber-primary text-white'
                                                    : 'bg-surface-container border-white/10 text-cinema-subtle hover:text-white hover:border-white/30'}`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-[11px] font-bold">Hiệu ứng nền chuyển động</span>
                                                    <span className={`shrink-0 w-7 h-4 rounded-full transition-colors relative ${shaderOn ? 'bg-amber-primary' : 'bg-white/20'}`}>
                                                        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-black transition-all ${shaderOn ? 'left-3.5' : 'left-0.5'}`} />
                                                    </span>
                                                </div>
                                                <p className="text-[10px] text-cinema-muted mt-0.5 leading-snug">
                                                    Tắt nếu máy yếu hoặc trình duyệt không tăng tốc phần cứng — đây là thứ tốn GPU nhất trên trang
                                                </p>
                                            </button>
                                        </div>

                                        {/* Audio enhancement */}
                                        <div>
                                            <div className="flex justify-between items-center mb-2">
                                                <p className="text-xs text-cinema-subtle font-bold uppercase tracking-wider">Âm thanh</p>
                                                {!audioFxStatus.supported && (
                                                    <span className="text-[10px] text-cinema-muted">không khả dụng ở luồng này</span>
                                                )}
                                            </div>
                                            {audioFxStatus.supported ? (
                                                <div className="space-y-1.5">
                                                    {([
                                                        {
                                                            id: 'clarity' as const,
                                                            label: 'Rõ thoại / chế độ đêm',
                                                            hint: 'Nén dải động, nhấn 2.5 kHz cho lời thoại',
                                                        },
                                                        {
                                                            id: 'widen' as const,
                                                            label: 'Mở rộng không gian (giả lập)',
                                                            hint: 'Hai loa ảo HRTF ±30° — hiệu ứng, không phải 5.1 thật',
                                                        },
                                                    ]).map((fx) => (
                                                        <button
                                                            key={fx.id}
                                                            onClick={() => updateAudioFx({ ...audioFx, [fx.id]: !audioFx[fx.id] })}
                                                            className={`w-full text-left px-2.5 py-2 rounded-md border transition-all ${audioFx[fx.id]
                                                                ? 'bg-amber-primary/15 border-amber-primary text-white'
                                                                : 'bg-surface-container border-white/10 text-cinema-subtle hover:text-white hover:border-white/30'}`}
                                                        >
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="text-[11px] font-bold">{fx.label}</span>
                                                                <span className={`shrink-0 w-7 h-4 rounded-full transition-colors relative ${audioFx[fx.id] ? 'bg-amber-primary' : 'bg-white/20'}`}>
                                                                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-black transition-all ${audioFx[fx.id] ? 'left-3.5' : 'left-0.5'}`} />
                                                                </span>
                                                            </div>
                                                            <p className="text-[10px] text-cinema-muted mt-0.5 leading-snug">{fx.hint}</p>
                                                        </button>
                                                    ))}
                                                    {audioFx.widen && (
                                                        <div className="px-2.5 pt-1 pb-2 rounded-md border border-white/10 bg-surface-container">
                                                            <div className="flex items-center justify-between mb-1">
                                                                <span className="text-[10px] text-cinema-subtle font-bold uppercase tracking-wider">Độ rộng phòng</span>
                                                                <span className="text-[10px] text-amber-gold font-bold">{Math.round(audioFx.width * 100)}%</span>
                                                            </div>
                                                            <input
                                                                type="range"
                                                                min={0}
                                                                max={100}
                                                                value={Math.round(audioFx.width * 100)}
                                                                onChange={(e) => updateAudioFx({ ...audioFx, width: Number(e.target.value) / 100 })}
                                                                className="w-full accent-amber-primary h-1 cursor-pointer"
                                                            />
                                                            <p className="text-[10px] text-cinema-muted mt-1 leading-snug">
                                                                Góc loa ảo, mức phản xạ và đuôi vọng — kéo thấp nếu nghe ồn
                                                            </p>
                                                        </div>
                                                    )}
                                                    <div className="px-2.5 pt-1 pb-2 rounded-md border border-white/10 bg-surface-container">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-[10px] text-cinema-subtle font-bold uppercase tracking-wider">Trễ tiếng</span>
                                                            <span className="text-[10px] text-amber-gold font-bold">{audioFx.lipSyncMs}ms</span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => updateAudioFx({ ...audioFx, lipSyncMs: clampLipSyncMs(audioFx.lipSyncMs - 25) })}
                                                                aria-label="Giảm trễ tiếng 25 mili giây"
                                                                className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-bold text-cinema-text hover:border-amber-primary/50 active:scale-95"
                                                            >
                                                                −25
                                                            </button>
                                                            <input
                                                                type="range"
                                                                min={0}
                                                                max={1000}
                                                                step={25}
                                                                value={audioFx.lipSyncMs}
                                                                onChange={(e) => updateAudioFx({ ...audioFx, lipSyncMs: clampLipSyncMs(Number(e.target.value)) })}
                                                                aria-label="Trễ tiếng (mili giây)"
                                                                className="w-full accent-amber-primary h-1 cursor-pointer"
                                                            />
                                                            <button
                                                                onClick={() => updateAudioFx({ ...audioFx, lipSyncMs: clampLipSyncMs(audioFx.lipSyncMs + 25) })}
                                                                aria-label="Tăng trễ tiếng 25 mili giây"
                                                                className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-bold text-cinema-text hover:border-amber-primary/50 active:scale-95"
                                                            >
                                                                +25
                                                            </button>
                                                        </div>
                                                        <p className="text-[10px] text-cinema-muted mt-1 leading-snug">
                                                            Dùng khi tiếng đi trước hình (môi theo sau). 0 = tắt, nhớ theo máy.
                                                        </p>
                                                        <button
                                                            type="button"
                                                            onClick={() => updateAudioFx({ ...audioFx, lipSyncMs: 0 })}
                                                            className="mt-1 w-full text-[10px] text-amber-gold hover:text-amber-bright underline"
                                                        >
                                                            Đặt lại về 0
                                                        </button>
                                                    </div>
                                                    {audioFxStatus.failed && (
                                                        <p className="text-[10px] text-red-400 leading-snug">
                                                            Trình duyệt từ chối xử lý âm thanh — đã trả về luồng gốc.
                                                        </p>
                                                    )}
                                                </div>
                                            ) : (
                                                <p className="text-[10px] text-cinema-muted leading-snug">
                                                    Chỉ hoạt động khi phát qua luồng remux. Luồng phát thẳng từ nguồn khác
                                                    origin không cho phép xử lý âm thanh.
                                                </p>
                                            )}
                                        </div>

                                        {/* Cinema room */}
                                        <div>
                                            <div className="flex justify-between items-center mb-2">
                                                <p className="text-xs text-cinema-subtle font-bold uppercase tracking-wider">Phòng chiếu</p>
                                            </div>
                                            <div className="space-y-1.5">
                                                {([
                                                    {
                                                        id: 'off' as const,
                                                        label: 'Tắt',
                                                        hint: 'Giữ nguyên trang',
                                                        available: true,
                                                    },
                                                    {
                                                        id: 'dim' as const,
                                                        label: 'Làm tối phòng',
                                                        hint: 'Tối xung quanh, còn lại ánh sáng nền chuyển động',
                                                        available: true,
                                                    },
                                                    {
                                                        id: 'ambilight' as const,
                                                        label: 'Quầng sáng theo phim',
                                                        hint: canSampleFrames
                                                            ? 'Lấy màu 16 vùng viền ~10 lần/giây — tốn thêm chút GPU'
                                                            : 'Cần luồng remux: luồng phát thẳng khác origin chặn canvas',
                                                        available: canSampleFrames,
                                                    },
                                                ]).map((opt) => (
                                                    <button
                                                        key={opt.id}
                                                        disabled={!opt.available}
                                                        onClick={() => changeCinema(opt.id)}
                                                        className={`w-full text-left px-2.5 py-2 rounded-md border transition-all ${!opt.available
                                                            ? 'bg-surface-container/50 border-white/5 text-cinema-muted cursor-not-allowed'
                                                            : cinema === opt.id
                                                                ? 'bg-amber-primary/15 border-amber-primary text-white'
                                                                : 'bg-surface-container border-white/10 text-cinema-subtle hover:text-white hover:border-white/30'}`}
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="text-[11px] font-bold">{opt.label}</span>
                                                            {opt.available && (
                                                                <span className={`shrink-0 w-3.5 h-3.5 rounded-full border-2 transition-colors ${cinema === opt.id ? 'border-amber-primary bg-amber-primary' : 'border-white/30'}`} />
                                                            )}
                                                        </div>
                                                        <p className="text-[10px] text-cinema-muted mt-0.5 leading-snug">{opt.hint}</p>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Audio track */}
                                        <div>
                                            <div className="flex justify-between items-center mb-2">
                                                <p className="text-xs text-cinema-subtle font-bold uppercase tracking-wider">Tiếng</p>
                                                {pendingAudioIndex !== null ? (
                                                    <span className="flex items-center gap-1 text-[10px] text-amber-gold">
                                                        <Loader2 size={11} className="animate-spin" /> đang đổi track…
                                                    </span>
                                                ) : (
                                                    subStatus === 'ready' && subAudio.length > 1 && (
                                                        <span className="text-[10px] text-cinema-muted">đổi track tải lại luồng</span>
                                                    )
                                                )}
                                            </div>
                                            {subStatus !== 'ready' ? (
                                                <p className="text-[11px] text-cinema-subtle italic py-1">
                                                    Bấm “Tải danh sách phụ đề” ở mục dưới để xem các track tiếng trong file.
                                                </p>
                                            ) : subAudio.length === 0 ? (
                                                <p className="text-[11px] text-cinema-subtle italic py-1">
                                                    Không đọc được track tiếng của file.
                                                </p>
                                            ) : (
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    {subAudio.map((a, i) => {
                                                        const active = (activeAudioIndex ?? 0) === i;
                                                        const switching = pendingAudioIndex === i;
                                                        const label =
                                                            !a.label || a.label === 'Không rõ'
                                                                ? (i === 0 ? 'Âm thanh gốc' : `Track ${i + 1}`)
                                                                : a.label;
                                                        return (
                                                            <button
                                                                key={i}
                                                                onClick={() => !active && onPickAudio?.(i)}
                                                                title={`${label}${a.codec ? ` · ${a.codec.toUpperCase()}` : ''}${a.channels ? ` · ${a.channels}ch` : ''}${switching ? ' · đang đổi…' : ''}`}
                                                                className={`px-2 py-1.5 rounded-md text-[10px] font-bold transition-all border truncate ${active
                                                                    ? 'bg-amber-primary text-black border-amber-primary'
                                                                    : 'bg-surface-container text-cinema-subtle border-white/10 hover:text-white'}`}
                                                            >
                                                                {switching ? (
                                                                    <span className="inline-flex items-center gap-1">
                                                                        <Loader2 size={11} className="animate-spin" /> Đang đổi…
                                                                    </span>
                                                                ) : (
                                                                    <>{label}{a.channels && a.channels >= 6 ? ` ${a.channels}ch` : ''}</>
                                                                )}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>

                                        {/* Subtitles + Audio languages */}
                                        <div>
                                            <div className="flex justify-between items-center mb-2">
                                                <p className="text-xs text-cinema-subtle font-bold uppercase tracking-wider flex items-center gap-1.5">
                                                    <Captions size={13} className="text-amber-gold" /> Phụ đề
                                                </p>
                                                {subAudio.length > 0 && (
                                                    <span className="text-[10px] text-cinema-muted font-mono truncate max-w-[130px]" title={subAudio.map((a) => `${a.label}${a.channels ? ` ${a.channels}ch` : ''}`).join(' · ')}>
                                                        🔊 {(!subAudio[0].label || subAudio[0].label === 'Không rõ') ? 'Âm thanh gốc' : subAudio[0].label}
                                                    </span>
                                                )}
                                            </div>

                                            {subStatus === 'idle' && (
                                                <button
                                                    onClick={() => void loadSubtitleInventory()}
                                                    className="w-full px-2 py-2 rounded-md text-[11px] font-bold bg-surface-container text-cinema-text border border-white/10 hover:border-amber-primary/40 hover:text-amber-gold transition-all"
                                                >
                                                    Tải danh sách phụ đề
                                                </button>
                                            )}
                                            {subStatus === 'loading' && (
                                                <div className="flex items-center justify-center gap-2 py-2 text-xs text-cinema-subtle">
                                                    <Loader2 size={14} className="animate-spin text-amber-primary" />
                                                    Đang tìm phụ đề…
                                                </div>
                                            )}
                                            {subStatus === 'error' && (
                                                <div className="text-center">
                                                    <p className="text-[11px] text-cinema-subtle py-1">{subError}</p>
                                                    <button
                                                        onClick={() => void loadSubtitleInventory()}
                                                        className="text-[11px] font-bold text-amber-gold hover:underline"
                                                    >
                                                        Thử lại
                                                    </button>
                                                </div>
                                            )}
                                            {subStatus === 'ready' && (
                                                <div className="space-y-2">
                                                    <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto custom-scrollbar">
                                                        <button
                                                            onClick={() => pickSubtitle('off')}
                                                            className={`px-2 py-1.5 rounded-md text-[10px] font-bold transition-all border ${selectedSub === 'off'
                                                                ? 'bg-amber-primary text-black border-amber-primary'
                                                                : 'bg-surface-container text-cinema-subtle border-white/10 hover:text-white'}`}
                                                        >
                                                            Tắt
                                                        </button>
                                                        {subTracks.map((t) => {
                                                            const pending = t.ready === false;
                                                            const verified = !pending && (isEmbeddedTrack(t) || t.matched === true);
                                                            return (
                                                                <button
                                                                    key={t.id}
                                                                    onClick={() => !pending && pickSubtitle(t.id)}
                                                                    disabled={pending}
                                                                    title={pending
                                                                        ? `${t.label} — đang trích từ file…`
                                                                        : isEmbeddedTrack(t)
                                                                            ? `${t.label} — trích từ file đang xem, khớp giờ`
                                                                            : t.matched === true
                                                                                ? `${t.label} — trùng bản với file đang xem, khớp giờ`
                                                                                : `${t.label} — phụ đề online, nếu lệch hãy thử track khác hoặc chỉnh độ trễ bên dưới`}
                                                                    className={`px-2 py-1.5 rounded-md text-[10px] font-bold transition-all border truncate ${selectedSub === t.id
                                                                        ? 'bg-amber-primary text-black border-amber-primary'
                                                                        : pending
                                                                            ? 'bg-surface-container text-cinema-subtle/50 border-white/5 cursor-wait'
                                                                            : 'bg-surface-container text-cinema-subtle border-white/10 hover:text-white'}`}
                                                                >
                                                                    {!pending && verified ? `✓ ${t.label}` : `${t.label}${pending ? '…' : ''}`}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    {/* OpenSubtitles verdict for THIS file. Saying so up front beats
                                                        letting the viewer discover the drift twenty minutes in. */}
                                                    {subMatch.checked && Object.entries(subMatch.languages).map(([lang, info]) => (
                                                        info.matched ? (
                                                            <p key={lang} className="text-[10px] leading-snug text-emerald-400">
                                                                {subLangName(lang)}: khớp đúng bản phim này, không cần chỉnh giờ.
                                                            </p>
                                                        ) : (
                                                            <p key={lang} className="text-[10px] leading-snug text-amber-gold/90">
                                                                {subLangName(lang)}: không có bản nào canh cho file đang xem
                                                                {info.release ? ` (bản hiện có làm cho “${info.release}”)` : ''} — có thể lệch giờ, dùng nút chỉnh độ trễ bên dưới.
                                                            </p>
                                                        )
                                                    ))}
                                                    {subNote && (
                                                        <p className="text-[10px] text-cinema-subtle italic leading-snug">{subNote}</p>
                                                    )}
                                                    {probeSubs.length > subTracks.length && (
                                                        <p className="text-[10px] text-cinema-subtle italic leading-snug">
                                                            File còn {probeSubs.length - subTracks.length} phụ đề ảnh ({probeSubs.filter((s) => !s.convertible).map((s) => s.codec.toUpperCase()).filter((v, i, a) => v && a.indexOf(v) === i).join('/') || 'PGS'}) không chuyển được thành chữ — chỉ hiện {subTracks.length} track text.
                                                        </p>
                                                    )}
                                                    {subTracks.length > 0 && selectedSub !== 'off' && (
                                                        <div className="rounded-lg border border-white/10 bg-surface-container/60 p-2">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-[10px] font-bold uppercase tracking-wider text-cinema-muted">
                                                                    Song ngữ{subTracks.filter((t) => t.ready !== false && t.url).length < 2 ? ' (cần ≥2 track)' : ''}
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    role="switch"
                                                                    aria-checked={bilingual}
                                                                    disabled={!bilingual && subTracks.filter((t) => t.ready !== false && t.url).length < 2}
                                                                    onClick={() => {
                                                                        const next = !bilingual;
                                                                        setBilingual(next);
                                                                        if (next) {
                                                                            const currentTrack = subTracks.find((t) => t.id === selectedSub);
                                                                            const candidate = pickSecondaryFor(currentTrack, subTracks);
                                                                            if (candidate) {
                                                                                setSecondarySub(candidate.id);
                                                                                void ensureCues(candidate);
                                                                            }
                                                                        }
                                                                    }}
                                                                    className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors disabled:opacity-40 ${bilingual ? 'justify-end bg-amber-primary' : 'justify-start bg-surface-container-highest'}`}
                                                                >
                                                                    <span className="block h-4 w-4 rounded-full bg-white shadow-sm"></span>
                                                                </button>
                                                            </div>
                                                             {bilingual && (
                                                                <div className="mt-2 space-y-2">
                                                                    <div className="grid grid-cols-2 gap-1.5">
                                                                        {subTracks
                                                                            .filter((t) => t.id !== selectedSub && t.ready !== false && t.url)
                                                                            .map((t) => (
                                                                                <button
                                                                                    key={t.id}
                                                                                    onClick={() => {
                                                                                        setSecondarySub(t.id);
                                                                                        void ensureCues(t);
                                                                                    }}
                                                                                    className={`px-2 py-1.5 rounded-md text-[10px] font-bold transition-all border truncate ${secondarySub === t.id
                                                                                        ? 'bg-cyan-accent text-black border-cyan-accent'
                                                                                        : 'bg-surface-container text-cinema-subtle border-white/10 hover:text-white'}`}
                                                                                >
                                                                                    {t.label}
                                                                                </button>
                                                                            ))}
                                                                    </div>
                                                                    <div className="flex items-center justify-between pt-1.5 border-t border-white/10">
                                                                        <span className="text-[10px] text-cinema-muted font-bold">Lệch phụ đề 2:</span>
                                                                        <span className="text-[10px] font-mono text-cyan-accent font-bold">
                                                                            {secondaryOffset > 0 ? `+${secondaryOffset.toFixed(1)}s` : `${secondaryOffset.toFixed(1)}s`}
                                                                        </span>
                                                                    </div>
                                                                    <div className="grid grid-cols-3 gap-1">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => adjustSecondaryOffset(-0.5)}
                                                                            className="px-1.5 py-1 rounded text-[10px] font-bold border transition-all bg-surface-container text-cinema-subtle border-white/10 hover:text-white"
                                                                        >
                                                                            −0.5s
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setSecondaryOffset(0);
                                                                                showSyncToast('Đã đặt lại lệch phụ đề 2 về 0s');
                                                                            }}
                                                                            className="px-1.5 py-1 rounded text-[10px] font-bold border transition-all bg-surface-container text-cinema-subtle border-white/10 hover:text-white"
                                                                        >
                                                                            0s
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => adjustSecondaryOffset(0.5)}
                                                                            className="px-1.5 py-1 rounded text-[10px] font-bold border transition-all bg-surface-container text-cinema-subtle border-white/10 hover:text-white"
                                                                        >
                                                                            +0.5s
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                             )}
                                                        </div>
                                                    )}
                                                    {cuesLoading && (
                                                        <p className="text-[10px] text-cinema-subtle text-center">Đang tải nội dung phụ đề…</p>
                                                    )}
                                                    {/* Subtitle appearance */}
                                                    <div className="rounded-lg border border-white/10 bg-surface-container/60 p-2 space-y-2">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="text-[10px] font-bold uppercase tracking-wider text-cinema-muted">
                                                                Cỡ chữ
                                                            </span>
                                                            <div className="flex gap-1.5">
                                                                {SUB_SIZES.map((s) => (
                                                                    <button
                                                                        key={s}
                                                                        onClick={() => {
                                                                            setSubSize(s);
                                                                            savePrefs({ scale: videoScale, subSize: s, subColor });
                                                                        }}
                                                                        className={`px-2 py-1 rounded-md text-[10px] font-bold border transition-all ${subSize === s
                                                                            ? 'bg-amber-primary text-black border-amber-primary'
                                                                            : 'bg-surface-container text-cinema-subtle border-white/10 hover:text-white'}`}
                                                                    >
                                                                        {s}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="text-[10px] font-bold uppercase tracking-wider text-cinema-muted">
                                                                Màu chữ
                                                            </span>
                                                            <div className="flex gap-1.5">
                                                                {SUB_COLORS.map((c) => (
                                                                    <button
                                                                        key={c.value}
                                                                        title={c.name}
                                                                        aria-label={`Chữ màu ${c.name}`}
                                                                        onClick={() => {
                                                                            setSubColor(c.value);
                                                                            savePrefs({ scale: videoScale, subSize, subColor: c.value });
                                                                        }}
                                                                        className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all ${subColor === c.value ? 'border-amber-primary scale-110' : 'border-white/20 hover:border-white/50'}`}
                                                                        style={{ backgroundColor: c.value }}
                                                                    >
                                                                        {subColor === c.value && (
                                                                            <span className="text-[10px] font-bold text-black">✓</span>
                                                                        )}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Subtitle sync delay */}
                                                    {selectedSub !== 'off' && (
                                                        <div className="rounded-lg border border-white/10 bg-surface-container/60 p-2 space-y-1.5">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-[10px] font-bold uppercase tracking-wider text-cinema-muted">
                                                                    Đồng bộ phụ đề
                                                                </span>
                                                                <span className={`text-[10px] font-mono font-bold ${subDelay === 0 ? 'text-cinema-muted' : 'text-amber-gold'}`}>
                                                                    {subDelay > 0 ? `+${subDelay.toFixed(1)}s` : `${subDelay.toFixed(1)}s`}
                                                                </span>
                                                            </div>
                                                            <div className="grid grid-cols-3 gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => adjustSubDelay(-0.1)}
                                                                    className="px-2 py-1.5 rounded-md text-[10px] font-bold transition-all border bg-surface-container text-cinema-subtle border-white/10 hover:text-white"
                                                                >
                                                                    −0.5s (trễ)
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        subDelayRef.current = 0;
                                                                        setSubDelay(0);
                                                                        patchPrefs({ subDelay: 0 });
                                                                        showSyncToast('Đã đặt lại đồng bộ phụ đề về 0s');
                                                                        const trackId = selectedSubRef.current;
                                                                        if (trackId && trackId !== 'off') {
                                                                            const map = readDelayMap();
                                                                            delete map[trackId];
                                                                            try { localStorage.setItem('cine_sub_delay_map', JSON.stringify(map)); } catch {}
                                                                        }
                                                                    }}
                                                                    className="px-2 py-1.5 rounded-md text-[10px] font-bold transition-all border bg-surface-container text-cinema-subtle border-white/10 hover:text-white"
                                                                >
                                                                    Đặt lại (0s)
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => adjustSubDelay(0.1)}
                                                                    className="px-2 py-1.5 rounded-md text-[10px] font-bold transition-all border bg-surface-container text-cinema-subtle border-white/10 hover:text-white"
                                                                >
                                                                    +0.5s (sớm)
                                                                </button>
                                                            </div>
                                                            <p className="text-[9px] text-cinema-subtle italic text-center">
                                                                Phím tắt: G (trễ lại 0.5s) · H (sớm hơn 0.5s)
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                </>,
                                containerRef.current
                                )}
                        </div>

                        <button onClick={toggleFullscreen} aria-label={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'} className="liquid-glass-btn shrink-0 text-white hover:text-cinema-muted transition-colors p-1.5 sm:p-2 hover:bg-white/10 rounded-full">
                            {isFullscreen ? <Minimize className="w-5 h-5 sm:w-[22px] sm:h-[22px]" /> : <Maximize className="w-5 h-5 sm:w-[22px] sm:h-[22px]" />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
