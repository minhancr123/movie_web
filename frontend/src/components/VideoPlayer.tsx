'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
    Play, Pause, Maximize, Minimize, Volume2, VolumeX,
    RotateCcw, RotateCw, Settings, SkipForward, Loader2, Captions
} from 'lucide-react';
import { useWatchHistory } from '../hooks/useLocalStorage';
import { playbackAPI, apiUrl } from '@/lib/api';
import { detectCapabilities } from '@/lib/capabilities';
import {
    fetchCues, activeCues,
    type SubCue, type SubTrack,
} from '@/lib/subtitles';
import {
    useAudioEnhancer, DEFAULT_AUDIO_ENHANCER,
    type AudioEnhancerSettings,
} from '../hooks/useAudioEnhancer';
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
    /** Ask the parent resolver for a fresh URL/session after local recovery is exhausted. */
    onPlaybackFailure?: (reason: string) => void;
    /**
     * The surround mode and the element to sample. Both are emitted rather than
     * used here: the player's own box clips its overflow, so the light has to be
     * drawn by an ancestor to spill past the bezel.
     */
    onCinemaChange?: (mode: CinemaMode) => void;
    onVideoReady?: (el: HTMLVideoElement | null) => void;
}

export default function VideoPlayer({ src, movie, episode, authToken, durationSeconds, onNextEpisode, subContext, onPickAudio, activeAudioIndex, onPlaybackFailure, onCinemaChange, onVideoReady }: VideoPlayerProps) {
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
    const syncToastTimerRef = useRef<NodeJS.Timeout>();

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

    const adjustSubDelay = useCallback((delta: number) => {
        const next = Math.min(30, Math.max(-30, Math.round((subDelayRef.current + delta) * 2) / 2));
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
    const rafRef = useRef<number>();

    const SUB_SIZES = [16, 20, 26, 32];
    const SUB_COLORS = [
        { name: 'Trắng', value: '#ffffff' },
        { name: 'Vàng', value: '#fde047' },
        { name: 'Cyan', value: '#67e8f9' },
        { name: 'Xanh lá', value: '#86efac' },
    ];
    const stallTimerRef = useRef<NodeJS.Timeout>();
    const lastProgressRef = useRef(0);

    /** A dead remux used to leave the spinner running forever. Detect a real
        no-progress stall quickly and ask the parent to resolve a fresh session. */
    const STALL_TIMEOUT_MS = 20000;
    const armStallTimer = () => {
        if (stallTimerRef.current) return;
        lastProgressRef.current = videoRef.current?.currentTime ?? 0;
        stallTimerRef.current = setTimeout(() => {
            stallTimerRef.current = undefined;
            const video = videoRef.current;
            if (video && !video.paused && !video.ended) {
                if (video.currentTime > lastProgressRef.current + 0.25) return;
                setIsLoading(false);
                const reason = 'Luồng phát không tiến triển trong 20 giây.';
                if (onPlaybackFailure) onPlaybackFailure(reason);
                else setError(`${reason} Bấm Thử lại để nối lại.`);
            }
        }, STALL_TIMEOUT_MS);
    };
    const clearStallTimer = () => {
        if (stallTimerRef.current) {
            clearTimeout(stallTimerRef.current);
            stallTimerRef.current = undefined;
        }
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

    const applyTracks = useCallback((tracks: SubTrack[]) => {
        setSubTracks(tracks);
        // Auto-pick Vietnamese once its file is ready.
        const vi = tracks.find((t) => t.ready !== false && t.language.toLowerCase().startsWith('vi'));
        if (vi) {
            setSelectedSub((prev) => {
                if (prev !== 'off') return prev;
                void ensureCues(vi);
                return vi.id;
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // Auto-pick English audio track if multiple audio tracks exist and none is selected
    useEffect(() => {
        if (subStatus !== 'ready' || subAudio.length <= 1) return;
        if (activeAudioIndex !== null && activeAudioIndex !== undefined) return;
        const engIdx = subAudio.findIndex(
            (a) => /^(en|eng|english)$/i.test(a.language?.trim()) || /tiếng anh/i.test(a.label?.trim())
        );
        if (engIdx > 0 && onPickAudio) {
            onPickAudio(engIdx);
        }
    }, [subStatus, subAudio, activeAudioIndex, onPickAudio]);

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

    useEffect(() => {
        if (!subJobId) return;
        const vi = subTracks.find((t) => t.ready !== false && t.language.toLowerCase().startsWith('vi'));
        if (vi && selectedSub === 'off') {
            setSelectedSub(vi.id);
            void ensureCues(vi);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subTracks, subJobId]);

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
        setSelectedSub(id);
        const track = subTracks.find((t) => t.id === id);
        if (track) void ensureCues(track);
        if (id === 'off') {
            setBilingual(false);
        } else if (bilingual && (id === secondarySub || !secondarySub)) {
            const nextLang = track?.language?.toLowerCase() || '';
            const readyTracks = subTracks.filter((t) => t.id !== id && t.ready !== false && t.url);
            const newSec = (nextLang.startsWith('vi')
                ? readyTracks.find((t) => (t as any).source === 'embedded' && t.language?.toLowerCase().startsWith('en'))
                    || readyTracks.find((t) => t.language?.toLowerCase().startsWith('en'))
                : readyTracks.find((t) => t.language?.toLowerCase().startsWith('vi')))
                || readyTracks.find((t) => !t.language?.toLowerCase().startsWith(nextLang.slice(0, 2)))
                || readyTracks[0];
            if (newSec) {
                setSecondarySub(newSec.id);
                void ensureCues(newSec);
            }
        }
    };

    // Auto-pick English audio track if available and not currently English
    useEffect(() => {
        if (subStatus !== 'ready' || subAudio.length <= 1) return;
        const currentLang = Number.isInteger(activeAudioIndex) && subAudio[activeAudioIndex!]
            ? subAudio[activeAudioIndex!].language
            : '';
        if (/^(en|eng|english)$/i.test(currentLang?.trim())) return; // Already English

        const engIdx = subAudio.findIndex(
            (a) => /^(en|eng|english)$/i.test(a.language?.trim())
        );
        if (engIdx >= 0 && engIdx !== activeAudioIndex && onPickAudio) {
            onPickAudio(engIdx);
        }
    }, [subStatus, subAudio, activeAudioIndex, onPickAudio]);

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

    // Lookup time shifted by manual delay: + pulls late cues earlier.
    const subLookupTime = currentTime + subDelay;
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
                }
            }
            rafId = requestAnimationFrame(checkTime);
        };

        rafId = requestAnimationFrame(checkTime);
        return () => {
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [src, retryKey]);

    const controlsTimeoutRef = useRef<NodeJS.Timeout>();
    const loadingTimeoutRef = useRef<NodeJS.Timeout>();
    const hlsRef = useRef<Hls | null>(null); // Keep reference to HLS instance
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

        const isHlsSrc = /\.m3u8(\?|#|$)/i.test(src);

        // This effect re-runs on src/token changes and tears down the old player.
        // A play() promise still pending at that moment rejects with AbortError
        // ("interrupted by a new load request"), so ignore results once stale.
        let cancelled = false;

        const startPlayback = () => {
            if (cancelled) return;
            video.play().then(
                () => { },
                (err: unknown) => {
                    if (cancelled) return;
                    // Autoplay blocked until the user gestures; not a failure.
                    if (err instanceof DOMException && err.name === 'AbortError') return;
                    setIsPlaying(false);
                },
            );
        };

        const restoreProgress = () => {
            const saved = history.find(h => h.slug === movie.slug);
            const duration = durationSeconds || (Number.isFinite(video.duration) ? video.duration : 0);
            if (saved && saved.currentEpisode === episode.slug && saved.progress) {
                video.currentTime = duration > 0 ? Math.min(saved.progress, Math.max(duration - 5, 0)) : saved.progress;
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

            hls.loadSource(src);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                // Quality is picked upstream (source picker), so the player
                // always stays on Auto here.
                hls.currentLevel = -1;

                // Restore history
                const saved = history.find(h => h.slug === movie.slug);
                if (saved && saved.currentEpisode === episode.slug && saved.progress) {
                    video.currentTime = saved.progress;
                }
                startPlayback();
                setIsLoading(false);
            });

            hls.on(Hls.Events.FRAG_LOADED, () => {
                fatalNetworkRecoveries = 0;
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
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
                    video.currentTime = saved.progress;
                }
                startPlayback();
                setIsLoading(false);
            });
        } else {
            setError("Trình duyệt không hỗ trợ HLS.");
        }

        return () => {
            cancelled = true;
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [src, movie.slug, episode.slug, authToken, retryKey, onPlaybackFailure]);

    // History Saver
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const saveProgress = async () => {
            if (video.paused || video.ended) return;

            const duration = durationSeconds || (Number.isFinite(video.duration) ? video.duration : 0);
            const currentTime = duration > 0 ? Math.min(video.currentTime, Math.max(duration - 5, 0)) : video.currentTime;

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
                    duration: video.duration
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
        return () => clearInterval(interval);
    }, [movie, episode, addToHistory]);

    // Event Listeners
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => {
            if (video.paused) setCurrentTime(video.currentTime);
            if (video.currentTime > lastProgressRef.current + 0.25) clearStallTimer();
            if (video.buffered.length > 0) {
                const bufferedEnd = video.buffered.end(video.buffered.length - 1);
                const duration = video.duration;
                if (duration > 0) {
                    setBuffered((bufferedEnd / duration) * 100);
                }
            }
        };

        const handleDurationChange = () => setDuration(durationSeconds || video.duration);
        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => {
            clearStallTimer();
            setIsPlaying(false);
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
            clearStallTimer();
            if (loadingTimeoutRef.current) {
                clearTimeout(loadingTimeoutRef.current);
                loadingTimeoutRef.current = undefined;
            }
            setIsLoading(false);
        };
        const handleCanPlay = () => {
            clearStallTimer();
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
    }, [onNextEpisode, durationSeconds, onPlaybackFailure]);

    // Controls Visibility
    const handleMouseMove = () => {
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => {
            if (isPlaying) setShowControls(false);
        }, 3000);
    };

    const togglePlay = useCallback(() => {
        if (videoRef.current) {
            if (isPlaying) videoRef.current.pause();
            else videoRef.current.play();
        }
    }, [isPlaying]);

    const toggleFullscreen = useCallback(() => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen();
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    }, []);

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

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = Number(e.target.value);
        if (videoRef.current) {
            videoRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const vol = Number(e.target.value);
        setVolume(vol);
        if (videoRef.current) {
            videoRef.current.volume = vol;
            setIsMuted(vol === 0);
        }
    };

    const toggleMute = () => {
        if (videoRef.current) {
            const newMuted = !isMuted;
            setIsMuted(newMuted);
            videoRef.current.muted = newMuted;
            if (newMuted) {
                setVolume(0);
            } else {
                setVolume(1);
                videoRef.current.volume = 1;
            }
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
                    if (videoRef.current) videoRef.current.currentTime += 10;
                    break;
                case 'arrowleft':
                    e.preventDefault();
                    if (videoRef.current) videoRef.current.currentTime -= 10;
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
                    adjustSubDelay(-0.5);
                    break;
                case 'h':
                    e.preventDefault();
                    adjustSubDelay(0.5);
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
    }, [togglePlay, toggleFullscreen, adjustSubDelay, adjustSecondaryOffset]);

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
            onMouseLeave={() => isPlaying && setShowControls(false)}
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

            {/* Keyboard Help Hint */}
            <div className={`absolute top-4 right-4 z-20 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5 text-white text-xs transition-opacity ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                <button onClick={(e) => { e.stopPropagation(); setShowKeyboardHelp(true); }} className="hover:text-amber-gold transition">
                    Press <kbd className="bg-white/20 px-1.5 py-0.5 rounded mx-1">?</kbd> for shortcuts
                </button>
            </div>

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

            {/* Big Play Button (when paused) */}
            {!isPlaying && !isLoading && (
                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                    <div className="w-20 h-20 bg-black/60 rounded-full flex items-center justify-center pl-2 shadow-2xl backdrop-blur-sm border border-white/10 group-hover:scale-110 transition-transform duration-300">
                        <Play className="text-white w-10 h-10 fill-white" />
                    </div>
                </div>
            )}

            {/* Custom subtitle overlay (single + bilingual). Rendered by hand
                instead of native <track> so cross-origin VTT needs no CORS
                changes on the media itself and two languages can show at once. */}
            {(primaryCues.length > 0 || secondaryCues.length > 0) && (
                <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex flex-col items-center gap-1.5 px-6 text-center">
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

            {/* Controls Overlay */}
            <div
                className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-4 pt-16 transition-opacity duration-300 z-30 ${showControls ? 'opacity-100' : 'opacity-0'}`}
                onClick={(e) => e.stopPropagation()}
                // Double-clicks on controls (e.g. the settings gear) must not
                // bubble to the container's onDoubleClick (= fullscreen).
                onDoubleClick={(e) => e.stopPropagation()}
            >
                {/* Progress Bar */}
                <div className="relative w-full h-1.5 group/progress cursor-pointer mb-4 flex items-center">
                    <div className="absolute top-0 left-0 h-full w-full bg-white/20 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-white/40"
                            style={{ width: `${buffered}%` }}
                        />
                    </div>
                    <div
                        className="absolute top-0 left-0 h-full bg-amber-primary rounded-full"
                        style={{ width: `${(currentTime / duration) * 100}%` }}
                    />
                    {/* Draggable Knob */}
                    <div
                        className="absolute w-4 h-4 bg-amber-primary rounded-full shadow-lg scale-0 group-hover/progress:scale-100 transition-transform duration-200 pointer-events-none"
                        style={{ left: `calc(${(currentTime / duration) * 100}% - 8px)` }}
                    />
                    <input
                        type="range"
                        min={0}
                        max={duration || 100}
                        step="0.1"
                        value={currentTime}
                        onChange={handleSeek}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                </div>

                <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 sm:gap-4">
                        <button onClick={togglePlay} className="text-white hover:text-amber-gold transition-colors">
                            {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
                        </button>

                        <div className="flex items-center gap-2 group/volume">
                            <button onClick={toggleMute} className="text-white hover:text-cinema-muted transition-colors">
                                {isMuted || volume === 0 ? <VolumeX size={22} /> : <Volume2 size={22} />}
                            </button>
                            <div className="w-0 overflow-hidden group-hover/volume:w-24 transition-all duration-300 flex items-center">
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.1}
                                    value={isMuted ? 0 : volume}
                                    onChange={handleVolumeChange}
                                    className="w-20 h-1 bg-surface-bright rounded-lg appearance-none cursor-pointer accent-amber-primary ml-2"
                                />
                            </div>
                        </div>

                        <div className="whitespace-nowrap text-xs sm:text-sm font-medium text-cinema-muted font-mono tracking-wider">
                            {formatTime(currentTime)} / {formatTime(duration)}
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 sm:gap-4">
                        {onNextEpisode && (
                            <button
                                onClick={onNextEpisode}
                                className="flex items-center gap-2 bg-white/10 hover:bg-amber-primary text-black text-sm px-3 sm:px-4 py-1.5 rounded-lg backdrop-blur-sm transition-all border border-white/10"
                            >
                                <SkipForward size={16} fill="white" />
                                <span className="hidden font-bold min-[420px]:inline"> Tập Tiếp</span>
                            </button>
                        )}

                        <div className="relative group/settings">
                            <button
                                onClick={toggleSettings}
                                className={`text-white hover:text-amber-gold transition-colors p-2 rounded-full hover:bg-white/10 ${showSettings ? 'text-amber-gold bg-white/10' : ''}`}
                            >
                                <Settings size={22} className={`transition-transform duration-500 ease-out ${showSettings ? 'rotate-90' : 'group-hover/settings:rotate-45'}`} />
                            </button>

                            {/* Settings Menu Popup: fixed to the viewport (not the
                                gear button) so a crowded/overflowing controls
                                row can never push it off-screen. Works in and
                                out of fullscreen. */}
                            {showSettings && (
                                <div
                                    {...{ [CINEMA_BRIGHT_ATTR]: '' }}
                                    className="fixed bottom-24 right-4 left-4 sm:left-auto sm:right-6 sm:w-80 max-h-[62vh] overflow-y-auto custom-scrollbar bg-black/90 backdrop-blur-md rounded-xl border border-white/10 p-4 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 z-[70]">
                                    <h4 className="text-white font-bold text-sm mb-3 border-b border-white/10/50 pb-2 flex items-center gap-2">
                                        <Settings size={14} className="text-amber-gold" /> Cài đặt phát
                                    </h4>

                                    <div className="space-y-4">
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
                                                {subStatus === 'ready' && subAudio.length > 1 && (
                                                    <span className="text-[10px] text-cinema-muted">đổi track tải lại luồng</span>
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
                                                        const label =
                                                            !a.label || a.label === 'Không rõ'
                                                                ? (i === 0 ? 'Âm thanh gốc (Tiếng Anh)' : `Track ${i + 1}`)
                                                                : a.label;
                                                        return (
                                                            <button
                                                                key={i}
                                                                onClick={() => !active && onPickAudio?.(i)}
                                                                title={`${label}${a.codec ? ` · ${a.codec.toUpperCase()}` : ''}${a.channels ? ` · ${a.channels}ch` : ''}`}
                                                                className={`px-2 py-1.5 rounded-md text-[10px] font-bold transition-all border truncate ${active
                                                                    ? 'bg-amber-primary text-black border-amber-primary'
                                                                    : 'bg-surface-container text-cinema-subtle border-white/10 hover:text-white'}`}
                                                            >
                                                                {label}{a.channels && a.channels >= 6 ? ` ${a.channels}ch` : ''}
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
                                                            return (
                                                                <button
                                                                    key={t.id}
                                                                    onClick={() => !pending && pickSubtitle(t.id)}
                                                                    disabled={pending}
                                                                    title={pending ? `${t.label} — đang trích…` : t.label}
                                                                    className={`px-2 py-1.5 rounded-md text-[10px] font-bold transition-all border truncate ${selectedSub === t.id
                                                                        ? 'bg-amber-primary text-black border-amber-primary'
                                                                        : pending
                                                                            ? 'bg-surface-container text-cinema-subtle/50 border-white/5 cursor-wait'
                                                                            : 'bg-surface-container text-cinema-subtle border-white/10 hover:text-white'}`}
                                                                >
                                                                    {t.label}{pending ? '…' : ''}
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
                                                                            const currentLang = currentTrack?.language?.toLowerCase() || '';
                                                                            const readyTracks = subTracks.filter((t) => t.id !== selectedSub && t.ready !== false && t.url);
                                                                            const candidate = (currentLang.startsWith('vi')
                                                                                ? readyTracks.find((t) => (t as any).source === 'embedded' && t.language?.toLowerCase().startsWith('en'))
                                                                                    || readyTracks.find((t) => t.language?.toLowerCase().startsWith('en'))
                                                                                : readyTracks.find((t) => t.language?.toLowerCase().startsWith('vi')))
                                                                                || readyTracks.find((t) => !t.language?.toLowerCase().startsWith(currentLang.slice(0, 2)))
                                                                                || readyTracks[0];
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
                                                                    onClick={() => adjustSubDelay(-0.5)}
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
                                                                    onClick={() => adjustSubDelay(0.5)}
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
                            )}
                        </div>

                        <button onClick={toggleFullscreen} className="text-white hover:text-cinema-muted transition-colors p-2 hover:bg-white/10 rounded-full">
                            {isFullscreen ? <Minimize size={22} /> : <Maximize size={22} />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
