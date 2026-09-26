'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { Loader2, AlertCircle, Key, RefreshCw, CheckCircle2, Download, Film, Layers, PictureInPicture2, ChevronLeft, ChevronRight, ListVideo } from 'lucide-react';
import VideoPlayer from '@/components/VideoPlayer';
import CinemaLayer, { type CinemaMode } from '@/components/CinemaLayer';

/** Mirrors PLAYBACK_STARTUP_BUFFER_SECONDS on the server, for the wait copy. */
const STARTUP_BUFFER_HINT = 15;

import { getResolveStageLabels, getFriendlyErrorMessage } from '@/lib/i18n';

const isProd = process.env.NODE_ENV === 'production';

/** Server resolve phases (GET /playback/resolve/:id/stage) in plain words. */
const RESOLVE_STAGE_LABELS = getResolveStageLabels(isProd);

const formatResolveStage = (stage: string, detail: string): string => {
  const base = RESOLVE_STAGE_LABELS[stage] || (isProd ? 'Đang chuẩn bị nguồn phát' : 'Đang chuẩn bị nguồn phát');
  // Hide technical detail in production if it looks like a filename or path
  if (isProd && detail && (detail.includes('.') || detail.includes('/') || detail.includes('['))) {
    return base;
  }
  return detail ? `${base} (${detail})` : base;
};

/**
 * 503 codes that mean "the work is fine, the server is not answering yet" — the
 * client waits and asks again instead of showing a dead end.
 *
 * REMUX_BUSY: every remux slot is taken.
 * SOURCE_PREPARE_TIMEOUT: the debrid provider stopped responding, so a release
 * that is already in the account never got read. Retrying is the whole point:
 * the alternative the server used to take (hand over a Vietsub CDN stream) is
 * a different cut, mistimed subtitles, and a spinner on a cold CDN.
 */
const RETRYABLE_503_CODES = new Set(['REMUX_BUSY', 'SOURCE_PREPARE_TIMEOUT']);
import { providerAPI, playbackAPI } from '@/lib/api';
import { detectCapabilities } from '@/lib/capabilities';
import { groupPlaybackSources } from '@/lib/source-groups';
import type { PlayerEpisode } from '@/lib/catalog';
import { episodeScrollTarget } from '@/lib/episode-list';
import { useWatchHistory } from '../hooks/useLocalStorage';
import { computeResumeAt, audioSwitchStartAt } from '@/lib/playback-progress';

interface PlaybackSectionProps {
  type: 'movie' | 'tv';
  tmdbId: number;
  season: number | null;
  episode: number | null;
  title: string;
  contentRef: string;
  /** Pro episodes panel data (TV), resolved server-side with real stills. */
  episodes?: PlayerEpisode[];
  activeEpisode?: number | null;
  seasonLabel?: string;
  /** Real poster URL — saved into watch history so rows can render artwork. */
  poster?: string;
  /** Full-length runtime in minutes (catalog detail): lets the first resolve
      open directly at the saved resume point instead of starting at 0 and
      re-resolving seconds later (film shows, then loads again). */
  runtimeMinutes?: number | null;
}

interface SourceCandidate {
  sourceToken?: string;
  filename?: string;
  playable?: boolean;
  resolution?: number | string | null;
  codec?: string | null;
  hdr?: string | null;
  releaseSource?: string | null;
  sizeBytes?: number | null;
  seeds?: number | null;
  cached?: boolean;
  score?: number | null;
  reasons?: string[];
  /** Non-torrent origin (e.g. 'vimo' direct HLS) for picker badging. */
  origin?: string | null;
}

const resolutionLabel = (value: number | string) => {
  const height = Number(value);
  if (!Number.isFinite(height)) return String(value);
  if (height >= 2160) return `4K (${height}p)`;
  if (height >= 1440) return `2K (${height}p)`;
  return `${height}p`;
};

const formatSize = (bytes: number) => {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
};

type PlaybackStatus =
  | 'idle'
  | 'checking_provider'
  | 'needs_provider'
  | 'resolving'
  | 'downloading'
  | 'ready'
  | 'error';

export default function PlaybackSection({
  type,
  tmdbId,
  season,
  episode,
  title,
  contentRef,
  episodes = [],
  activeEpisode = null,
  seasonLabel = '',
  poster = '',
  runtimeMinutes = null,
}: PlaybackSectionProps) {
  const { data: session, status: authStatus } = useSession();
  const { history } = useWatchHistory();

  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [playUrl, setPlayUrl] = useState<string>('');
  const playUrlRef = useRef<string>('');
  // Forces VideoPlayer to rebuild its hls.js pipeline even when resolve
  // returns the identical URL (reused session): React bails out on an
  // unchanged src, so without this the stuck player is never destroyed and
  // the stall watchdog never re-arms.
  const [reloadKey, setReloadKey] = useState<number>(0);
  const applyPlayUrl = useCallback((url: string) => {
    if (url && url === playUrlRef.current) setReloadKey((k) => k + 1);
    playUrlRef.current = url;
    setPlayUrl(url);
  }, []);
  const [fileName, setFileName] = useState<string>('');
  const [playMode, setPlayMode] = useState<string>('');
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  // Display offset of the current session's timeline (0 = from the start).
  // Far seeks resolve a session beginning at the target; the player maps its
  // truncated 0-based playlist back onto the full film with this.
  const [startOffset, setStartOffset] = useState<number>(0);
  // Reported by the server: how far the remux clock leads source time, so the
  // player can take it back out of subtitle lookups.
  const [presentationShiftMs, setPresentationShiftMs] = useState<number>(0);
  // Whether the server offers truncated (seek-started) sessions at all.
  // Assume yes until told otherwise, so an older backend behaves as before.
  const [seekStartSupported, setSeekStartSupported] = useState<boolean>(true);
  // Chosen inside the player, drawn here: the surround must escape the player's
  // own overflow-hidden frame to read as light spilling onto the page.
  /**
   * Seconds spent on the current resolve.
   *
   * A cold start is genuinely 10-20 s of work — finding a source, probing it,
   * giving ffmpeg a head start — and the screen used to show one unchanging
   * line for the whole of it, which reads as a hang. A counter is honest about
   * the wait without pretending to know a percentage it cannot measure.
   */
  const [resolveElapsed, setResolveElapsed] = useState(0);
  /**
   * Live phase reported by the server for the current resolve
   * (GET /playback/resolve/:id/stage). Replaces the old elapsed-time step
   * estimates with measurement: TorBox prepare, link, probe, remux, buffer.
   */
  const [resolveStageLabel, setResolveStageLabel] = useState('');
  const stagePollRef = useRef<NodeJS.Timeout | null>(null);
  // Consecutive stage-poll 404s for the current resolveId (reset per resolve).
  const stage404sRef = useRef<number>(0);
  const [cinemaMode, setCinemaMode] = useState<CinemaMode>('off');
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const fullscreenTargetRef = useRef<HTMLDivElement>(null);
  const [candidate, setCandidate] = useState<SourceCandidate | null>(null);
  const [sources, setSources] = useState<SourceCandidate[]>([]);
  const [showSources, setShowSources] = useState<boolean>(false);
  const [isLoadingSources, setIsLoadingSources] = useState<boolean>(false);
  const [activeToken, setActiveToken] = useState<string>('');
  const [playbackSessionId, setPlaybackSessionId] = useState<string>('');
  // Preferred embedded audio track (ffprobe order). Survives re-resolves via ref.
  const [activeAudioIndex, setActiveAudioIndex] = useState<number | null>(null);
  const activeAudioIndexRef = useRef<number | null>(null);
  // Audio switch in flight (ffprobe-order index): set on pick, cleared when
  // any resolve applies or terminals. Drives the spinner on the target track
  // button — without it the highlight flips instantly while the old audio
  // keeps playing for seconds, reading as "bấm mà không có gì xảy ra".
  const [pendingAudioIndex, setPendingAudioIndex] = useState<number | null>(null);
  // One-shot notice banner (e.g. decode-overload downgrade). Dismissible.
  const [notice, setNotice] = useState<string | null>(null);
  // Auto quality step-down fires once per title: no flapping between releases.
  const decodeDowngradeDoneRef = useRef<boolean>(false);
  const episodeScrollRef = useRef<HTMLDivElement>(null);

  const scrollEpisodes = (direction: 'left' | 'right') => {
    if (!episodeScrollRef.current) return;
    const container = episodeScrollRef.current;
    const scrollAmount = 600;
    container.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  // The card of the episode being watched, kept so the strip can be scrolled
  // to it again when the episode changes without the node remounting.
  const activeCardNodeRef = useRef<HTMLElement | null>(null);

  /**
   * Episode the player is actually on, which is not always the one the URL says.
   *
   * Switching episodes used to be a <Link> navigation. The watch page is an
   * async Server Component, so every navigation re-renders it behind the
   * route-level loading.tsx — and that fallback replaces the whole subtree: the
   * <video> element was destroyed, playback had to resolve again from scratch,
   * and the episode strip came back as a new node at scrollLeft 0. The server
   * was never the slow part (measured TTFB 117-142ms with the season warm in
   * Redis); the teardown was the cost.
   *
   * So the switch is client state. replaceState keeps the address bar truthful
   * — a reload or a shared link still opens that episode — without asking the
   * router to re-render anything, so the player is left alone. The prop still
   * wins after a real navigation, which is what this reset is for.
   */
  const [switchedEpisode, setSwitchedEpisode] = useState<number | null>(null);
  const currentEpisode = switchedEpisode ?? episode ?? null;
  useEffect(() => {
    setSwitchedEpisode(null);
  }, [episode]);

  // Brings the watching episode onto the strip. Manual math, because
  // scrollIntoView also scrolls every vertical ancestor and yanks the whole
  // page. Card widths are fixed (w-44), so image loads cannot shift it.
  //
  // `instant` is load-bearing: the strip carries `scroll-smooth`, so the
  // default `auto` resolves to a CSS-smooth animation that is still running a
  // frame later — long enough for anything touching the strip to interrupt it,
  // and the list stayed where it was. An instant jump lands before the next
  // paint.
  const revealActiveEpisode = useCallback(() => {
    const container = episodeScrollRef.current;
    if (!container) return;
    // Ask the DOM, not a callback ref. When the active card moves from one
    // episode to the next in a single commit, React detaches the old ref
    // (calling it with null) and attaches the new one; the detach is free to
    // land AFTER the attach, which left activeCardNodeRef.current null and
    // every later reveal bailing on `if (!node) return` — so the strip sat at
    // episode 1 while the URL, the badge and the player all said episode 7.
    // A query has no ordering to get wrong. The ref stays only as a fallback
    // for the frame before React has committed the attribute.
    const node =
      container.querySelector<HTMLElement>('[data-active="true"]')
      || activeCardNodeRef.current;
    if (!node || !container.contains(node)) return;
    const target = episodeScrollTarget({
      cardOffsetLeft: node.offsetLeft,
      cardWidth: node.clientWidth,
      containerWidth: container.clientWidth,
      contentWidth: container.scrollWidth,
      currentScrollLeft: container.scrollLeft,
    });
    if (target === container.scrollLeft) return;
    container.scrollTo({ left: target, behavior: 'instant' as ScrollBehavior });
  }, []);

  // Hint only. Never stores null: that is exactly the clobber above. The
  // attribute query is what the reveal actually uses.
  const activeCardRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    activeCardNodeRef.current = node;
    revealActiveEpisode();
  }, [revealActiveEpisode]);

  // Episode changes keep every card mounted (they are keyed by number), so on
  // a move from one episode to the next the ref alone is not a reliable
  // trigger: follow the active episode itself as well.
  //
  // A single pass is not enough, though. Switching episodes navigates, and the
  // route-level loading.tsx tears the panel down and rebuilds it — so the strip
  // is a brand-new node at scrollLeft 0, and the one pass that runs on mount
  // measures it before the browser has settled a width, which is the case
  // episodeScrollTarget deliberately answers with "do nothing". Re-run across a
  // couple of frames and once more after layout has had time to land; the strip
  // ends on the active episode instead of the first one.
  useEffect(() => {
    let cancelled = false;
    revealActiveEpisode();
    const frame = requestAnimationFrame(() => {
      if (!cancelled) revealActiveEpisode();
    });
    const settle = setTimeout(() => {
      if (!cancelled) revealActiveEpisode();
    }, 350);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(settle);
    };
  }, [currentEpisode, episodes.length, revealActiveEpisode]);

  // Rotation, a resized panel or a maximised player all change the strip's
  // width, which re-snaps it and can walk the active card back out of view.
  useEffect(() => {
    const container = episodeScrollRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => revealActiveEpisode());
    observer.observe(container);
    return () => observer.disconnect();
  }, [revealActiveEpisode]);

  const pickAudio = useCallback(
    (index: number) => {
      if (index === activeAudioIndexRef.current) return;
      const prevIndex = activeAudioIndexRef.current;
      setActiveAudioIndex(index);
      activeAudioIndexRef.current = index;
      setPendingAudioIndex(index);
      // Same release, different audio: keep the current stream on screen while
      // the new track's session warms up, then reload and resume via history.
      // Preserves the current timeline offset and supersedes any pending seek
      // (the audio switch is the newer intent).
      pendingSeekRef.current = null;
      const epoch = ++seekEpochRef.current;
      // The new track's remux writes from wherever it is told to. Asking for
      // the session origin restarts the film there, and the player then resumes
      // to the viewer's position against bytes that have not been written yet —
      // which looks exactly like the switch doing nothing.
      const at = audioSwitchStartAt({
        playhead: playheadRef.current,
        sessionStart: startOffsetRef.current,
      });
      void startPlaybackResolutionRef.current(activeTokenRef.current, index, {
        preservePlayer: true,
        ...(at > 0 ? { startAt: at } : {}),
        seekEpoch: epoch,
      }).catch((err: unknown) => {
        // The resolve itself throws for seek/audio intents (the player toasts
        // over the still-running picture) — without this catch the rejection
        // escapes as an unhandled runtime error and tears down the page.
        // Roll the optimistic highlight back to the track still playing.
        setActiveAudioIndex(prevIndex);
        activeAudioIndexRef.current = prevIndex;
        const reason = (err as { response?: { data?: { message?: string } }; message?: string })
          ?.response?.data?.message
          || (err instanceof Error && err.message)
          || 'không rõ nguyên nhân';
        setNotice(`Không đổi được track tiếng: ${String(reason).slice(0, 140)}`);
      });
    },
    []
  );
  const [torboxKeyInput, setTorboxKeyInput] = useState<string>('');
  const [isSubmittingKey, setIsSubmittingKey] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string>('');

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const recoveryAttemptsRef = useRef(0);
  const recoveryInFlightRef = useRef(false);
  /** 503 REMUX_BUSY auto-retry counter (reset each fresh resolve). */
  const busyRetriesRef = useRef(0);
  // Latest-value mirrors so stable callbacks never close over stale state.
  // Live playhead in full-film seconds, fed by the player's timeupdate.
  const playheadRef = useRef<number>(0);
  const activeTokenRef = useRef<string>('');
  const startPlaybackResolutionRef = useRef<
    (
      sourceToken?: string,
      audioIndex?: number,
      options?: {
        preservePlayer?: boolean;
        startAt?: number;
        seekEpoch?: number;
        serverRetry?: boolean;
      },
    ) => Promise<void>
  >(async () => {});
  const loadSourcesRef = useRef<() => Promise<void>>(async () => {});

  const selectedSourceKey = `playback:selectedSource:${type}:${tmdbId}:${season ?? 'movie'}:${currentEpisode ?? 'full'}`;

  // Resume seed for the FIRST auto-resolve only. Without this, opening a
  // half-watched title resolves from 0, starts playing, then the player's
  // post-hoc resume finds its target past the fresh remux head and fires a
  // SECOND full resolve that supersedes the playing session — the "phim đã
  // hiện rồi mà vẫn load tiếp" loop from the logs (6.9s + 5.6s + supersede).
  const initialStartAtRef = useRef<number>(0);
  const seedConsumedForRef = useRef<string | null>(null);
  const episodeSlug = season && currentEpisode ? `s${season}e${currentEpisode}` : 'full';
  const getResumeSeed = useCallback((): number => {
    try {
      const saved = history.find((h) => h.slug === contentRef);
      if (!saved || saved.currentEpisode !== episodeSlug) return 0;
      const duration = runtimeMinutes && runtimeMinutes > 0 ? runtimeMinutes * 60 : 0;
      const at = computeResumeAt(saved.progress, duration);
      return at !== null && at > 0 ? Math.floor(at) : 0;
    } catch {
      return 0;
    }
  }, [history, contentRef, episodeSlug, runtimeMinutes]);

  const recoverPlayback = useCallback((reason: string) => {
    // A fatal HLS event and the no-progress watchdog can fire together. Only
    // one of them may create a replacement remux session.
    if (recoveryInFlightRef.current) return;
    recoveryAttemptsRef.current += 1;
    if (recoveryAttemptsRef.current > 2) {
      setPlaybackStatus('error');
      setErrorMessage(`${reason} Đã thử tạo lại luồng 2 lần; hãy chọn nguồn khác.`);
      if (typeof window !== 'undefined') {
        localStorage.removeItem(selectedSourceKey);
      }
      void loadSourcesRef.current();
      setShowSources(true);
      return;
    }
    recoveryInFlightRef.current = true;
    setErrorMessage(`Luồng bị gián đoạn, đang tự khôi phục (${recoveryAttemptsRef.current}/2)…`);
    // Recovery rebuilds the CURRENT timeline: adopt a pending seek target if
    // the stall struck mid-seek (rebuilding from the old position would
    // strand the viewer where they tried to leave), else keep the applied
    // session offset. Takes its own epoch so an older in-flight resolve
    // cannot clobber it — and vice versa.
    const recoverAt =
      pendingSeekRef.current ??
      (startOffsetRef.current > 0
        ? startOffsetRef.current
        : initialStartAtRef.current > 0
          ? initialStartAtRef.current
          : 0);
    const epoch = ++seekEpochRef.current;
    void startPlaybackResolutionRef
      .current(
        activeTokenRef.current,
        activeAudioIndexRef.current ?? undefined,
        { preservePlayer: true, ...(recoverAt > 0 ? { startAt: recoverAt } : {}), seekEpoch: epoch },
      )
      .catch((err: unknown) => {
        // Same unhandled-rejection trap as pickAudio: the resolve throws for
        // seek intents, and .finally() alone does not catch. Surface it in
        // the banner instead of crashing the page; the attempts counter
        // above already bounded the retries.
        const reason = (err as { response?: { data?: { message?: string } }; message?: string })
          ?.response?.data?.message
          || (err instanceof Error && err.message)
          || 'không rõ nguyên nhân';
        setErrorMessage(`Tự khôi phục thất bại: ${String(reason).slice(0, 140)} Thử chọn nguồn khác.`);
      })
      .finally(() => {
        recoveryInFlightRef.current = false;
      });
  }, [selectedSourceKey]);

  // Isolated stalls must not accumulate: steady progress clears the counter.
  const handlePlaybackProgress = useCallback((positionSeconds: number) => {
    if (recoveryAttemptsRef.current !== 0) recoveryAttemptsRef.current = 0;
    // Where the viewer actually is, in full-film seconds. An audio switch
    // rebuilds the remux for the chosen track and has to start it here, not at
    // the session's origin — see audioSwitchStartAt.
    if (Number.isFinite(positionSeconds) && positionSeconds > 0) {
      playheadRef.current = positionSeconds;
    }
  }, []);

  // Decoder can't keep up (audio permanently ahead of the picture): step down
  // to the next-lighter release at the current position instead of leaving
  // every heavy title lagging. Falls back to opening the source list when no
  // lighter candidate is on hand.
  const handleDecodeOverload = useCallback(() => {
    if (decodeDowngradeDoneRef.current) return;
    decodeDowngradeDoneRef.current = true;
    const heightOf = (s: SourceCandidate) => {
      const h = Number(s.resolution);
      return Number.isFinite(h) && h > 0 ? h : 0;
    };
    const currentH = candidate ? heightOf(candidate) : Number.POSITIVE_INFINITY;
    const lighter = sources
      .filter((s) => s.playable !== false && s.sourceToken && heightOf(s) > 0 && heightOf(s) < currentH)
      .sort((a, b) => heightOf(b) - heightOf(a))[0];
    if (lighter?.sourceToken) {
      const lightH = heightOf(lighter);
      const lightLabel = lightH > 0 ? resolutionLabel(lightH) : 'bản nhẹ hơn';
      setNotice(
        `Máy giải mã không kịp bản hiện tại (tiếng đi trước hình) — đã tự chuyển xuống ${lightLabel} cho mượt. Đổi lại trong danh sách nguồn bất cứ lúc nào.`,
      );
      const at = Math.max(
        0,
        Math.floor((startOffsetRef.current || 0) + (videoEl?.currentTime || 0)),
      );
      recoveryAttemptsRef.current = 0;
      recoveryInFlightRef.current = false;
      void startPlaybackResolutionRef.current(
        lighter.sourceToken,
        activeAudioIndexRef.current ?? undefined,
        { preservePlayer: true, ...(at > 0 ? { startAt: at } : {}) },
      ).catch((err: unknown) => {
        // Downgrade resolve carries a startAt, so its failure rethrows —
        // without this catch it escapes as an unhandled runtime error.
        const reason = (err as { response?: { data?: { message?: string } }; message?: string })
          ?.response?.data?.message
          || (err instanceof Error && err.message)
          || 'không rõ nguyên nhân';
        setNotice(`Không chuyển được xuống ${lightLabel}: ${String(reason).slice(0, 140)} Thử chọn nguồn khác.`);
      });
    } else {
      setNotice(
        'Máy giải mã không kịp bản hiện tại (tiếng đi trước hình) — hãy chọn nguồn nhẹ hơn bên dưới.',
      );
      setShowSources(true);
      void loadSourcesRef.current();
    }
  }, [candidate, sources, videoEl]);

  const clearPoll = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const clearStagePoll = () => {
    if (stagePollRef.current) {
      clearInterval(stagePollRef.current);
      stagePollRef.current = null;
    }
  };

  // New title, new decode budget: allow one step-down again, drop the banner.
  useEffect(() => {
    decodeDowngradeDoneRef.current = false;
    setNotice(null);
  }, [type, tmdbId, season, currentEpisode]);

  useEffect(() => {
    return () => {
      clearPoll();
      clearStagePoll();
      resolveAbortRef.current?.abort();
      resolveAbortRef.current = null;
      resolveInFlightRef.current = null;
      resolveInFlightEpochRef.current = null;
      // StrictMode remount (dev) must re-seed like a fresh mount.
      seedConsumedForRef.current = null;
      initialStartAtRef.current = 0;
    };
  }, []);

  // Pro toolbar PiP: drives the <video> rendered by VideoPlayer below.
  const togglePip = useCallback(async () => {
    try {
      const video = document.querySelector('video');
      if (!video) return;
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('[player] PiP failed:', err);
    }
  }, []);

  /**
   * Guards against resolving the same thing twice at once.
   *
   * StrictMode mounts effects twice in development, so the auto-start fires two
   * resolves milliseconds apart. Each one starts its own ffmpeg against the same
   * title, and a measured pair of them saturated ~36 MB/s of link and disk
   * between them — enough to make the playback they were preparing stutter.
   * Requests that differ (a deliberate source or audio switch) still go through.
   */
  const resolveInFlightRef = useRef<string | null>(null);
  // Epoch of the request holding the slot above. The finally block only
  // releases the slot when BOTH match, so a superseded (aborted) request
  // landing late cannot clear the newer request's slot.
  const resolveInFlightEpochRef = useRef<number | null>(null);
  // Abort handle for the in-flight resolve HTTP call. StrictMode mounts
  // effects twice in development: without this, the first (abandoned) mount's
  // resolve still applies when it lands — rebuilding a player the remount
  // just created — and two concurrent remux pipelines burn link side by side.
  // Aborting is client-side only: the server keeps working, so the remount's
  // resolve typically reuses the warmed session instead of starting cold.
  const resolveAbortRef = useRef<AbortController | null>(null);
  // Far-seek generation: each fired seek-resolve takes a number; a response
  // whose number is stale was superseded by a retarget and must not apply.
  // Recovery shares the same counter (see recoverPlayback): every
  // preservePlayer re-resolve is one intent stream, and only the latest
  // intent may replace the picture — otherwise a slow full-session recovery
  // landing after a seek yanks playback back to the abandoned position.
  const seekEpochRef = useRef<number>(0);
  // Target of the in-flight seek-resolve, if any. A recovery that fires
  // while a seek is pending adopts it instead of rebuilding from the old
  // (stalled) position, which would strand the viewer where they tried to
  // leave. Cleared whenever any resolve response applies.
  const pendingSeekRef = useRef<number | null>(null);
  // Applied session offset mirror (startOffset state): recovery and audio
  // switches re-resolve the CURRENT timeline, not from zero.
  const startOffsetRef = useRef<number>(0);

  const handleResolveResponse = useCallback((data: any, requestEpoch: number) => {
    if (seekEpochRef.current !== requestEpoch) return;
    // Any applied resolve settles a pending audio switch: the new bytes are
    // on screen (or warming with the new session id), so the button spinner
    // must not outlive it.
    setPendingAudioIndex(null);

    setCandidate(data.candidate || null);
    setPlaybackSessionId(typeof data.sessionId === 'string' ? data.sessionId : '');
    // How far the remux clock leads source time; the player takes it back
    // out of subtitle lookups (see subtitleLookupTime).
    setPresentationShiftMs(
      typeof data.presentationShiftMs === 'number' && data.presentationShiftMs > 0
        ? data.presentationShiftMs
        : 0,
    );
    const returnedOffset = typeof data.startOffset === 'number' && data.startOffset > 0 ? data.startOffset : 0;
    setStartOffset(returnedOffset);
    startOffsetRef.current = returnedOffset;
    pendingSeekRef.current = null;
    
    const effectiveToken = activeTokenRef.current || (typeof data.sourceToken === 'string' ? data.sourceToken : '');
    setActiveToken(effectiveToken);
    activeTokenRef.current = effectiveToken;
    // Pin the release across reloads and later intents: every resume,
    // recovery and retry re-sends it instead of re-picking a possibly
    // different cut (subs mistimed, different audio mix) of the same title.
    if (effectiveToken) {
      try {
        if (typeof window !== 'undefined') localStorage.setItem(selectedSourceKey, effectiveToken);
      } catch {
        // Storage blocked: the pin lasts this mount via activeTokenRef.
      }
    }

    if (typeof data.audioIndex === 'number') {
      setActiveAudioIndex(data.audioIndex);
      activeAudioIndexRef.current = data.audioIndex;
    }

    const playlistUrl = data.playlistUrl || data.playUrl;

    if (data.mode === 'direct' && data.url) {
      if (Array.isArray(data.streams)) setSources(data.streams);
      applyPlayUrl(data.url);
      setFileName(data.fileName || '');
      setPlayMode('direct');
      setDurationSeconds(null);
      setPlaybackStatus('ready');
    } else if (data.mode === 'remux' && playlistUrl) {
      if (Array.isArray(data.streams)) setSources(data.streams);
      const backendBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';
      const absoluteUrl = playlistUrl.startsWith('http')
        ? playlistUrl
        : `${backendBase.replace(/\/api\/?$/, '')}${playlistUrl}`;

      setPlaybackSessionId(typeof data.sessionId === 'string' ? data.sessionId : '');
      setFileName(data.fileName || '');
      setPlayMode('remux');
      setDurationSeconds(typeof data.durationSeconds === 'number' ? data.durationSeconds : null);

      if (data.warmingUp === true && data.sessionId) {
        setPlaybackStatus('downloading');
        setDownloadProgress(0);
        applyPlayUrl(absoluteUrl);
      } else {
        applyPlayUrl(absoluteUrl);
        setPlaybackStatus('ready');
      }
    }
  }, []);

  // Far seek past the written playlist head: keep the current picture up
  // while a session beginning at the target warms up. The player debounces
  // scrub ticks and shows its own indicator; here each call fires exactly
  // one resolve, and stale responses are dropped by the epoch check above.
  const requestSeekPosition = useCallback((displaySeconds: number) => {
    const at = Math.max(0, Math.floor(displaySeconds));
    pendingSeekRef.current = at;
    // A newer seek supersedes a pending audio switch (and vice versa in
    // pickAudio): the stale button spinner must not survive the new intent.
    setPendingAudioIndex(null);
    const epoch = ++seekEpochRef.current;
    return startPlaybackResolutionRef.current(
      activeTokenRef.current,
      activeAudioIndexRef.current ?? undefined,
      { preservePlayer: true, startAt: at, seekEpoch: epoch },
    );
  }, []);

  // The viewer went back to direct seeking while a seek-resolve was in
  // flight: invalidate it so its late response cannot apply.
  const cancelSeekPosition = useCallback(() => {
    pendingSeekRef.current = null;
    // Cancelling invalidates every in-flight intent by epoch, including a
    // pending audio switch whose late response can no longer apply — its
    // spinner must go with it.
    setPendingAudioIndex(null);
    seekEpochRef.current += 1;
  }, []);

  const startPlaybackResolution = useCallback(async (
    sourceToken?: string,
    audioIndex?: number,
    options?: {
      preservePlayer?: boolean;
      startAt?: number;
      seekEpoch?: number;
      serverRetry?: boolean;
    },
  ) => {
    // Storage can throw when blocked: never let it reject the resolve.
    let rememberedToken = '';
    try {
      rememberedToken =
        typeof window !== 'undefined' ? localStorage.getItem(selectedSourceKey) || '' : '';
    } catch {
      rememberedToken = '';
    }
    const resolvedSourceToken = sourceToken || rememberedToken || '';
    const resolvedAudioIndex =
      audioIndex !== undefined ? audioIndex : activeAudioIndexRef.current;
    const resolvedStartAt =
      options?.startAt && options.startAt > 0 ? Math.floor(options.startAt) : 0;
    // Every resolve takes the current generation number (seek/recovery/audio
    // passes its own so the intent survives the 4xx retry below). Only the
    // latest generation may replace the picture: a slow earlier resolve
    // landing after a newer seek, source pick or recovery would otherwise
    // yank playback back to an abandoned position.
    const requestEpoch = options?.seekEpoch ?? ++seekEpochRef.current;

    // startAt is part of the identity: rapid seeks to different positions
    // must each resolve instead of the second being dropped as a duplicate.
    const requestKey = `${resolvedSourceToken}|${resolvedAudioIndex ?? ''}|${resolvedStartAt}`;
    // Same-key take-over (not a silent bail): every fresh call above already
    // bumped the epoch, so an in-flight same-key response is doomed by the
    // epoch check below. Bailing here would strand the newer intent with no
    // request at all — status stuck on 'resolving' forever after a 200.
    // Only a true duplicate (same key AND same epoch, e.g. an explicit
    // seekEpoch re-fired twice) may dedupe, because that in-flight request
    // will still apply when it lands.
    if (
      resolveInFlightRef.current === requestKey &&
      resolveInFlightEpochRef.current === requestEpoch
    ) {
      return;
    }
    resolveInFlightRef.current = requestKey;
    resolveInFlightEpochRef.current = requestEpoch;

    // A newer intent replaces the previous HTTP call (source/audio/seek
    // switch, retry, or StrictMode remount). The server keeps working on the
    // abandoned one — its session simply becomes reusable — so aborting only
    // stops us waiting for and applying a stale answer.
    resolveAbortRef.current?.abort();
    const resolveController = new AbortController();
    resolveAbortRef.current = resolveController;

    clearPoll();
    clearStagePoll();
    stage404sRef.current = 0;
    setErrorMessage('');
    setResolveElapsed(0);
    setResolveStageLabel('');
    // A server-asked retry continues the SAME resolve: resetting here would let
    // it clear its own counter and retry forever.
    if (options?.serverRetry !== true) busyRetriesRef.current = 0;
    // Fresh progress for the seek overlay (it mirrors these two states while
    // a far seek resolves). Stale warm percent from an earlier session must
    // not leak into the new one.
    setDownloadProgress(0);
    const preservePlayer = options?.preservePlayer === true && Boolean(playUrlRef.current);
    if (!preservePlayer) setPlaybackStatus('resolving');

    // Client progress key so the server can report its live phase while the
    // resolve HTTP call stays open (up to minutes on a slow upstream).
    const resolveId = (() => {
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
      } catch {
        // Fall through to the timestamp fallback below.
      }
      return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    })();
    const pollResolveStage = async () => {
      if (resolveAbortRef.current?.signal.aborted) {
        clearStagePoll();
        return;
      }
      try {
        const r = await playbackAPI.getResolveStage(resolveId);
        const st = r.data?.data;
        if (st?.stage) setResolveStageLabel(formatResolveStage(st.stage, st.detail || ''));
        
        // AUTO-ADOPT: If the stage poll found valid playback data while the main resolve is still pending
        const adoptionUrl = st?.playUrl || st?.playlistUrl;
        if (st?.mode && adoptionUrl && seekEpochRef.current === requestEpoch) {
          // Check if this resolve is still the intended one
          if (resolveAbortRef.current?.signal.aborted) return;
          
          console.log('[playback] Stage poll found ready session, adopting early...');
          clearStagePoll();
          // Abort the main HTTP call so its later finally/success doesn't overwrite this adoption
          resolveAbortRef.current?.abort();
          resolveAbortRef.current = null;

          // BRIDGE: The main resolve call would normally start the warming poll
          // timer. When adopting early, we must check if we need to start it
          // here to avoid getting stuck in 'downloading' status with no poll.
          if (st.mode === 'remux' && st.warmingUp === true && st.sessionId) {
            const warmId = st.sessionId;
            const backendBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';
            const absoluteUrl = adoptionUrl.startsWith('http')
              ? adoptionUrl
              : `${backendBase.replace(/\/api\/?$/, '')}${adoptionUrl}`;
            const warmUrl = absoluteUrl;
            const warmTarget =
              typeof st.startupTargetSeconds === 'number' && st.startupTargetSeconds > 0
                ? st.startupTargetSeconds
                : (options?.startAt && options.startAt > 0) ? 4 : 15;

            setPlaybackStatus('downloading');
            setDownloadProgress(0);
            setPlaybackSessionId(st.sessionId);
            setFileName(st.fileName || '');
            setPlayMode('remux');
            setDurationSeconds(typeof st.durationSeconds === 'number' ? st.durationSeconds : null);
            applyPlayUrl(warmUrl);

            let warmPolls = 0;
            let warmFails = 0;
            const finishWarm = () => {
              clearPoll();
              applyPlayUrl(warmUrl);
              setPlaybackStatus('ready');
            };

            clearPoll(); // Ensure clean start
            pollTimerRef.current = setInterval(async () => {
              warmPolls += 1;
              try {
                const pollRes = await playbackAPI.getSession(warmId);
                const sessionData = pollRes.data?.data;
                warmFails = 0;
                if (!sessionData) return;
                const buffered =
                  typeof sessionData.bufferedSeconds === 'number'
                    ? sessionData.bufferedSeconds
                    : null;
                if (typeof sessionData.progress === 'number') {
                  setDownloadProgress(sessionData.progress);
                } else if (buffered !== null) {
                  setDownloadProgress(Math.min(99, Math.round((buffered / warmTarget) * 100)));
                }
                if (sessionData.ready === true) {
                  finishWarm();
                  return;
                }
                if (sessionData.writerAlive === false) {
                  clearPoll();
                  // In early adopt bridge, we can't easily call recoverPlayback
                  // without a ref refactor, but we can at least drop to error
                  // or trigger a fresh resolve.
                  setPlaybackStatus('resolving');
                  startPlaybackResolutionRef.current(activeTokenRef.current, undefined, { ...options, seekEpoch: requestEpoch }).catch((err: unknown) => {
                    // Floating promise: the surrounding try/catch cannot see
                    // an async rejection, so without this the 422 escapes as
                    // an unhandled runtime error and tears down the page.
                    const reason = (err as { response?: { data?: { message?: string } }; message?: string })
                      ?.response?.data?.message
                      || (err instanceof Error && err.message)
                      || 'không rõ nguyên nhân';
                    setNotice(`Tạo lại luồng thất bại: ${String(reason).slice(0, 140)} Thử chọn nguồn khác.`);
                  });
                  return;
                }
                if (warmPolls >= 30) finishWarm();
              } catch {
                // A failed poll means the session is unreachable — most often
                // the server restarted and took the writer with it. Counting
                // failures and giving up turned that into a 60s dead end on a
                // stream that could never grow again; re-resolving is what the
                // writerAlive===false branch above already does, and it is the
                // only thing that recovers.
                warmFails += 1;
                if (warmFails >= 3) {
                  clearPoll();
                  setPlaybackStatus('resolving');
                  startPlaybackResolutionRef
                    .current(activeTokenRef.current, undefined, { ...options, seekEpoch: requestEpoch })
                    .catch((err: unknown) => {
                      const reason = (err as { response?: { data?: { message?: string } }; message?: string })
                        ?.response?.data?.message
                        || (err instanceof Error && err.message)
                        || 'không rõ nguyên nhân';
                      setNotice(`Tạo lại luồng thất bại: ${String(reason).slice(0, 140)} Thử chọn nguồn khác.`);
                    });
                  return;
                }
              }
            }, 2000);
          } else {
            handleResolveResponse(st, requestEpoch);
          }
          return;
        }
        
        stage404sRef.current = 0;
      } catch (err: any) {
        if (err?.response?.status === 404) {
          stage404sRef.current += 1;
          if (stage404sRef.current >= 3 && stagePollRef.current) {
            clearStagePoll();
          }
        }
      }
    };
    void pollResolveStage();
    // Local handle: the 4xx-retry path below re-enters this function, and the
    // outer finally must not kill the retry's poll.
    const stageTimer = setInterval(pollResolveStage, 1500);
    stagePollRef.current = stageTimer;

    // Lip-sync compensation in ms, persisted on this device (same
    // display chain every film, so it is setup-constant). Sent to the
    // server so the delay is baked into the HLS segments at remux
    // time rather than relying on the browser-side audio tap alone.
    let lipSyncMs = 0;
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('cine_player_prefs') : null;
      if (raw) lipSyncMs = Math.max(0, Number(JSON.parse(raw)?.audio?.lipSyncMs) || 0);
    } catch { /* ignore */ }

    try {
      const caps = detectCapabilities();
      const res = await playbackAPI.resolve({
        type,
        tmdbId,
        season: season ?? undefined,
        episode: currentEpisode ?? undefined,
        capabilities: caps,
        resolveId,
        ...(resolvedSourceToken ? { sourceToken: resolvedSourceToken } : {}),
        ...(resolvedAudioIndex !== null && resolvedAudioIndex !== undefined
          ? { audioIndex: resolvedAudioIndex }
          : {}),
        // Seek-start: the server begins the (re)mux at this position so
        // far seeks do not wait for the whole prefix. 0/absent = from the start.
        ...(resolvedStartAt > 0 ? { startAt: resolvedStartAt } : {}),
        ...(lipSyncMs > 0 ? { lipSyncMs } : {}),
      }, resolveController.signal);

      const data = res.data?.data;
      if (!data) {
        throw new Error('Dữ liệu phản hồi không hợp lệ');
      }

      // Superseded resolve: a newer seek, source pick, audio switch or
      // recovery fired while this one was in flight. Applying it would yank
      // playback to an abandoned intent (and resurrect a session the
      // superseded-stop pass is reaping), so the late response is dropped —
      // the newer intent's own resolve applies.
      if (seekEpochRef.current !== requestEpoch) {
        if (typeof window !== 'undefined') {
          console.debug(`[seek] dropped stale resolve (epoch ${requestEpoch}, current ${seekEpochRef.current})`);
        }
        return;
      }

      setCandidate(data.candidate || null);
      setPlaybackSessionId(typeof data.sessionId === 'string' ? data.sessionId : '');
      // Truncated-timeline origin of this session (0 = from the start). The
      // player maps its 0-based playlist back onto the full film with it.
      // How far the remux clock leads source time; the player takes it back
      // out of subtitle lookups (see subtitleLookupTime).
      setSeekStartSupported(data.seekStartSupported !== false);
      setPresentationShiftMs(
        typeof data.presentationShiftMs === 'number' && data.presentationShiftMs > 0
          ? data.presentationShiftMs
          : 0,
      );
      const returnedOffset = typeof data.startOffset === 'number' && data.startOffset > 0 ? data.startOffset : 0;
      setStartOffset(returnedOffset);
      startOffsetRef.current = returnedOffset;
      // This resolve's intent is fulfilled: a pending seek it supersedes (or
      // embodies) must not linger into a later recovery.
      pendingSeekRef.current = null;
      setPendingAudioIndex(null);
      // A silent source swap looks exactly like mistimed subtitles: the Vimo
      // fallback carries its own encode (different cut/timing), so sidecars
      // timed for the picked release cannot line up on it. Say so loudly;
      // clear only our own banner when a later resolve comes back clean.
      if (data.fallbackSource) {
        setNotice(
          `BẢN DỰ PHÒNG: nguồn chính quá chậm nên đang phát bản Vimo thay thế — video là bản khác nên phụ đề online sẽ lệch giờ. Tua lại sau ít phút để về bản gốc.`,
        );
      } else {
        setNotice((prev) => (prev && prev.startsWith('BẢN DỰ PHÒNG') ? null : prev));
      }
      // Same materiality rule as the player's toast: a start position rounded
      // down to the bucket is the request being honoured, not dropped.
      if (
        resolvedStartAt - returnedOffset > 30
        && returnedOffset <= 0
        && data.seekStartSupported !== false
        && typeof window !== 'undefined'
      ) {
        // A seek asked for a session beginning at resolvedStartAt but the
        // server answered from-the-start: applying it would yank playback
        // backwards, so say so loudly in the console instead of failing blind.
        console.warn(
          `[seek] requested startAt=${resolvedStartAt}s but response has no startOffset; ` +
          `sessionId=${typeof data.sessionId === 'string' ? data.sessionId : '?'} mode=${data.mode || '?'}`,
        );
      }
      const effectiveToken = resolvedSourceToken || (typeof data.sourceToken === 'string' ? data.sourceToken : '');
      setActiveToken(effectiveToken);
      activeTokenRef.current = effectiveToken;
      if (sourceToken && typeof window !== 'undefined') {
        localStorage.setItem(selectedSourceKey, sourceToken);
      }
      if (typeof data.audioIndex === 'number') {
        setActiveAudioIndex(data.audioIndex);
        activeAudioIndexRef.current = data.audioIndex;
      }

      if (data.mode === 'direct' && data.url) {
        if (Array.isArray(data.streams)) {
          setSources(data.streams);
        }
        applyPlayUrl(data.url);
        setFileName(data.fileName || '');
        setPlayMode('direct');
        setDurationSeconds(null);
        setPlaybackStatus('ready');
      } else if (data.mode === 'remux' && data.playlistUrl) {
        if (Array.isArray(data.streams)) {
          setSources(data.streams);
        }
        const backendBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';
        const absoluteUrl = data.playlistUrl.startsWith('http')
          ? data.playlistUrl
          : `${backendBase.replace(/\/api\/?$/, '')}${data.playlistUrl}`;

        // Still filling its head start: hold the first frame until the buffer
        // reaches the startup target instead of playing 8s then stalling at
        // ~0:28 waiting for segments. The session poll reports real buffered
        // seconds so the wait shows progress, not a frozen caption.
        if (data.warmingUp === true && data.sessionId) {
          const warmId = data.sessionId;
          const warmUrl = absoluteUrl;
          const warmTarget =
            typeof data.startupTargetSeconds === 'number' && data.startupTargetSeconds > 0
              ? data.startupTargetSeconds
              : resolvedStartAt > 0 ? 4 : 15;
          if (!preservePlayer) setPlaybackStatus('downloading');
          setDownloadProgress(0);
          setPlaybackSessionId(typeof data.sessionId === 'string' ? data.sessionId : '');
          setFileName(data.fileName || '');
          setPlayMode('remux');
          setDurationSeconds(typeof data.durationSeconds === 'number' ? data.durationSeconds : null);
          let warmPolls = 0;
          let warmFails = 0;
          const finishWarm = () => {
            clearPoll();
            applyPlayUrl(warmUrl);
            setPlaybackStatus('ready');
          };
          pollTimerRef.current = setInterval(async () => {
            warmPolls += 1;
            try {
              const pollRes = await playbackAPI.getSession(warmId);
              const sessionData = pollRes.data?.data;
              warmFails = 0;
              if (!sessionData) return;
              const buffered =
                typeof sessionData.bufferedSeconds === 'number'
                  ? sessionData.bufferedSeconds
                  : null;
              if (typeof sessionData.progress === 'number') {
                setDownloadProgress(sessionData.progress);
              } else if (buffered !== null) {
                setDownloadProgress(Math.min(99, Math.round((buffered / warmTarget) * 100)));
              }
              if (sessionData.ready === true) {
                finishWarm();
                return;
              }
              if (sessionData.writerAlive === false) {
                // A partial EVENT playlist cannot finish playing after its
                // writer dies. Resolving again replaces the dead remux instead
                // of handing VideoPlayer a stream that is guaranteed to freeze.
                clearPoll();
                recoverPlayback(isProd ? 'Luồng phát đã dừng, đang thử lại.' : 'Luồng remux đã ngừng tạo dữ liệu.');
                return;
              }
              if (warmPolls >= 30) finishWarm();
            } catch {
              warmFails += 1;
              if (warmFails >= 5) finishWarm();
            }
          }, 2000);
        } else {
          applyPlayUrl(absoluteUrl);
          setFileName(data.fileName || '');
          setPlayMode('remux');
          setDurationSeconds(typeof data.durationSeconds === 'number' ? data.durationSeconds : null);
          setPlaybackStatus('ready');
        }

        // Speculatively preload the next bucket if known
        if (data.sessionId) {
          const currentOffset = returnedOffset || resolvedStartAt || 0;
          playbackAPI.preload({
            sessionId: data.sessionId,
            timestamps: [currentOffset + 300],
            type,
            tmdbId,
            season: season ?? undefined,
            episode: currentEpisode ?? undefined,
          }).catch(() => {});
        }
      } else if (data.mode === 'downloading' || data.mode === 'preparing') {
        if (!preservePlayer) setPlaybackStatus('downloading');
        setDownloadProgress(data.progress || 0);

        if (data.sessionId) {
          const pollId = data.sessionId;
          let failures = 0;
          // 6s, not 4s: a TorBox cache job takes minutes, and the session
          // endpoint hits TorBox on every poll.
          pollTimerRef.current = setInterval(async () => {
            try {
              const pollRes = await playbackAPI.getSession(pollId);
              const sessionData = pollRes.data?.data;
              failures = 0;
              if (sessionData) {
                setDownloadProgress(sessionData.progress || 0);
                if (sessionData.mode === 'remux' && sessionData.playlistUrl) {
                  clearPoll();
                  const backendBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';
                  const absoluteUrl = sessionData.playlistUrl.startsWith('http')
                    ? sessionData.playlistUrl
                    : `${backendBase.replace(/\/api\/?$/, '')}${sessionData.playlistUrl}`;
                  applyPlayUrl(absoluteUrl);
                  setPlaybackSessionId(
                    typeof sessionData.sessionId === 'string' ? sessionData.sessionId : pollId,
                  );
                  setFileName(sessionData.fileName || '');
                  setPlayMode('remux');
                  setDurationSeconds(typeof sessionData.durationSeconds === 'number' ? sessionData.durationSeconds : null);
                  setPlaybackStatus('ready');
                } else if (
                  sessionData.mode === 'ready-to-resolve' ||
                  sessionData.mode === 'ready' ||
                  sessionData.mode === 'direct'
                ) {
                  clearPoll();
                  startPlaybackResolution(sourceToken, undefined, options);
                }
              }
            } catch (pollErr: any) {
              // Give up after repeated failures instead of hammering a backend
              // that is rate-limiting us or has gone away.
              failures += 1;
              if (failures >= 5) {
                clearPoll();
                setPlaybackStatus('error');
                setPendingAudioIndex(null);
                setErrorMessage(
                  pollErr?.response?.status === 429
                    ? 'Bị giới hạn tần suất, vui lòng chờ một phút rồi thử lại'
                    : 'Mất kết nối tới server khi theo dõi tiến trình tải',
                );
              }
            }
          }, 6000);
        }
      } else {
        throw new Error('Chế độ phát không được nhận diện');
      }
    } catch (err: any) {
      // Abandoned by design (unmount, superseded intent): never surface as an
      // error and never disturb the newer resolve already in flight.
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') {
        return;
      }
      const status = err.response?.status;
      const code = err.response?.data?.code;
      const message = err.response?.data?.message || err.message || 'Không thể chuẩn bị nguồn phát';

      if (!sourceToken && resolvedSourceToken && status && status >= 400 && status < 500 && typeof window !== 'undefined') {
        localStorage.removeItem(selectedSourceKey);
        setActiveToken('');
        activeTokenRef.current = '';
        // Released before the retry so the follow-up is never mistaken for a
        // duplicate of the request that just failed.
        resolveInFlightRef.current = null;
        resolveInFlightEpochRef.current = null;
        // A failed seek retries into the same rejection channel so the player
        // can toast over the still-playing picture instead of going silent.
        if (options?.startAt) return startPlaybackResolution('', undefined, options);
        startPlaybackResolution('', undefined, options);
        return;
      }

      // Server-side "come back in a moment" answers. Handled BEFORE the seek
      // rethrow below: a far seek that stalls on a busy server is the exact
      // case that must retry itself rather than toast over a frozen frame.
      if (status === 503 && RETRYABLE_503_CODES.has(code) && (busyRetriesRef.current ?? 0) < 3) {
        // REMUX_BUSY: every ffmpeg slot is taken. On a single-slot box the slot
        // can be held for a whole remux, so a short ladder is a coin flip — say
        // what is happening instead of showing a spinner that means nothing.
        // SOURCE_PREPARE_TIMEOUT: the debrid provider stopped answering; the
        // release is untouched and ready in seconds once it does.
        const busy = code === 'REMUX_BUSY';
        const waitMs = busy ? 8000 : 10000;
        busyRetriesRef.current = (busyRetriesRef.current ?? 0) + 1;
        setResolveStageLabel(
          isProd
            ? busy
              ? `Tập khác đang được chuẩn bị, thử lại (${busyRetriesRef.current}/3)…`
              : `Dịch vụ lưu trữ đang phản hồi chậm, tự động thử lại (${busyRetriesRef.current}/3)…`
            : `${code} — retry ${busyRetriesRef.current}/3 in ${waitMs / 1000}s`,
        );
        // Say it once, in words, at the first refusal. The stage label scrolls
        // away; this does not, and it is the difference between "the site is
        // broken" and "the server is finishing another episode".
        if (busy && busyRetriesRef.current === 1) {
          setNotice(
            'Máy chủ đang chuẩn bị tập khác nên phải xếp hàng. Thường mất vài chục giây; tập này sẽ tự phát khi xong.',
          );
        }
        // The spinner stays up: the viewer is still waiting on this resolve,
        // just a few seconds later. Released before the retry so the follow-up
        // is never mistaken for a duplicate of the request that just failed.
        resolveInFlightRef.current = null;
        resolveInFlightEpochRef.current = null;
        setPendingAudioIndex(null);
        await new Promise((r) => setTimeout(r, waitMs));
        if (seekEpochRef.current === requestEpoch) {
          return startPlaybackResolution(sourceToken, audioIndex, {
            ...options,
            seekEpoch: requestEpoch,
            serverRetry: true,
          });
        }
        return;
      }

      // Seek-resolve failure: the old picture is still up underneath, so keep
      // it and report through the rejection (the player toasts the reason
      // over the video) instead of tearing down into the error screen.
      // Ordinary resolves keep the show-error-screen behaviour below.
      // Either way the pending audio spinner is over: the switch did not land.
      if (options?.startAt) {
        setPendingAudioIndex(null);
        throw err;
      }

      if (status === 401 && (err.response?.data?.code === 'invalid_token' || err.response?.data?.code === 'no_token')) {
        setPlaybackStatus('needs_provider');
        setPendingAudioIndex(null);
        setKeyError(message);
      } else if (err?.code === 'ECONNABORTED') {
        // Axios timeout: connection silently hung (common on mobile networks)
        setPlaybackStatus('error');
        setPendingAudioIndex(null);
        setErrorMessage('Hết thời gian chờ — mạng quá chậm hoặc server không phản hồi. Thử lại hoặc đổi nguồn.');
      } else {
        setPlaybackStatus('error');
        setPendingAudioIndex(null);
        // The 422 carries why each top release was rejected — surface the
        // first reason so a dead end is diagnosable instead of a blank wall.
        const rejected = err.response?.data?.rejected;
        const hint =
          !isProd && Array.isArray(rejected) && rejected[0]?.reasons?.[0]
            ? ` (VD: ${rejected[0].reasons[0]})`
            : '';
        setErrorMessage(getFriendlyErrorMessage(`${message}${hint}`, isProd));
      }
    } finally {
      if (stagePollRef.current === stageTimer) clearStagePoll();
      if (
        resolveInFlightRef.current === requestKey &&
        resolveInFlightEpochRef.current === requestEpoch
      ) {
        resolveInFlightRef.current = null;
        resolveInFlightEpochRef.current = null;
      }
      if (resolveAbortRef.current === resolveController) resolveAbortRef.current = null;
    }
  }, [type, tmdbId, season, currentEpisode, selectedSourceKey, recoverPlayback]);

  // Keep the stable mirrors in sync after every render.
  startPlaybackResolutionRef.current = startPlaybackResolution;

  const loadSources = useCallback(async () => {
    setIsLoadingSources(true);
    try {
      const res = await playbackAPI.listSources({
        type,
        tmdbId,
        season: season ?? undefined,
        episode: currentEpisode ?? undefined,
        capabilities: detectCapabilities(),
      });
      setSources(res.data?.data?.sources || []);
      setShowSources(true);
    } catch (err: any) {
      setErrorMessage(err.response?.data?.message || 'Không tải được danh sách nguồn');
    } finally {
      setIsLoadingSources(false);
    }
  }, [type, tmdbId, season, currentEpisode]);

  loadSourcesRef.current = loadSources;

  const checkProviderConnection = useCallback(async () => {
    if (authStatus === 'unauthenticated') {
      setPlaybackStatus('error');
      setErrorMessage('Vui lòng đăng nhập để bắt đầu phát video');
      return;
    }
    if (authStatus !== 'authenticated') {
      return;
    }

    setPlaybackStatus('checking_provider');
    try {
      const res = await providerAPI.getStatus();
      const torbox = res.data?.data?.torbox;
      if (torbox && torbox.connected) {
        // First auto-start on an episode opens at the saved position when there
        // is one, so the player never plays from 0 just to re-resolve seconds
        // later. Manual source picks / retries intentionally start at 0 (or
        // their explicit startAt) and must not consume this seed.
        //
        // Scoped to the episode, not to the mount. It used to be a boolean that
        // the component's lifetime owned, which was fine only because every
        // episode switch remounted the page and reset it. Client-side switching
        // keeps this instance alive, so a boolean would have handed the seed to
        // episode 1 and then started every later episode from 0 — losing the
        // resume position the viewer came for.
        const seed = seedConsumedForRef.current === episodeSlug ? 0 : getResumeSeed();
        seedConsumedForRef.current = episodeSlug;
        initialStartAtRef.current = seed;
        startPlaybackResolution(undefined, undefined, seed > 0 ? { startAt: seed } : undefined);
      } else {
        setPlaybackStatus('needs_provider');
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        setPlaybackStatus('error');
        setErrorMessage('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại');
      } else {
        setPlaybackStatus('needs_provider');
      }
    }
  }, [authStatus, startPlaybackResolution, getResumeSeed]);

  useEffect(() => {
    if (playbackStatus !== 'resolving') return;
    const started = Date.now();
    const id = setInterval(() => setResolveElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
  }, [playbackStatus]);

  useEffect(() => {
    checkProviderConnection();
  }, [checkProviderConnection]);

  const handleConnectTorbox = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!torboxKeyInput.trim()) return;

    setIsSubmittingKey(true);
    setKeyError('');

    try {
      await providerAPI.connectTorbox(torboxKeyInput.trim());
      setTorboxKeyInput('');
      const seed = seedConsumedForRef.current === episodeSlug ? 0 : getResumeSeed();
      seedConsumedForRef.current = episodeSlug;
      initialStartAtRef.current = seed;
      startPlaybackResolution(undefined, undefined, seed > 0 ? { startAt: seed } : undefined);
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Không thể liên kết TorBox API key';
      setKeyError(msg);
    } finally {
      setIsSubmittingKey(false);
    }
  };

  if (playbackStatus === 'checking_provider' || authStatus === 'loading') {
    return (
      <div className="aspect-video w-full rounded-xl bg-surface-dark flex flex-col items-center justify-center border border-white/5 p-6 text-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-3" />
        <p className="text-cinema-muted text-sm font-medium">Đang kiểm tra kết nối dịch vụ…</p>
      </div>
    );
  }

  if (playbackStatus === 'needs_provider') {
    return (
      <div className="aspect-video w-full rounded-xl bg-surface-dark flex flex-col items-center justify-center border border-white/10 p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary mb-4">
          <Key size={24} />
        </div>
        <h3 className="text-lg font-bold text-white mb-2">Kết nối tài khoản TorBox</h3>
        <p className="text-sm text-cinema-subtle max-w-md mb-6 leading-relaxed">
          Phim được tìm và phát trực tiếp thông qua debrid TorBox của bạn (hỗ trợ 4K/HEVC, không transcode). Vui lòng dán TorBox API token của bạn để tiếp tục.
        </p>

        <form onSubmit={handleConnectTorbox} className="w-full max-w-md space-y-3">
          <div className="flex flex-col gap-1 text-left">
            <input
              type="password"
              placeholder="Dán TorBox API token..."
              value={torboxKeyInput}
              onChange={(e) => setTorboxKeyInput(e.target.value)}
              className="w-full bg-black/60 border border-white/15 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary transition"
              required
            />
            {keyError && <p className="text-xs text-amber-gold mt-1">{keyError}</p>}
          </div>

          <button
            type="submit"
            disabled={isSubmittingKey || !torboxKeyInput.trim()}
            className="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-2.5 rounded-lg text-sm transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isSubmittingKey ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Đang xác thực…</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Xác nhận kết nối</span>
              </>
            )}
          </button>
        </form>

        <p className="text-xs text-cinema-subtle mt-4">
          Lấy API key tại: <a href="https://torbox.app/settings" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">torbox.app/settings</a>
        </p>
      </div>
    );
  }

  if (playbackStatus === 'resolving') {
    return (
      <div className="aspect-video w-full rounded-xl bg-surface-dark flex flex-col items-center justify-center border border-white/5 p-6 text-center">
        <Film className="w-10 h-10 text-primary animate-pulse mb-3" />
        <p className="text-cinema-text text-sm font-semibold mb-1">
          Đang chuẩn bị nguồn phát… <span className="font-mono text-amber-gold">{resolveElapsed}s</span>
        </p>
        <p className="text-cinema-subtle text-xs max-w-sm mb-3">
          Lần đầu mỗi phim mất khoảng 10–20 giây: tìm nguồn, kiểm codec, rồi dựng
          sẵn {STARTUP_BUFFER_HINT}s đệm. Những lần sau gần như tức thì.
        </p>
        {/* Live server stage: measurement, not the old elapsed-time guess. */}
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span
            key={resolveStageLabel}
            className="px-2 py-0.5 rounded border border-amber-primary/60 text-amber-gold bg-amber-primary/10 animate-pulse"
          >
            {resolveStageLabel || 'Đang bắt đầu…'}
          </span>
        </div>
        {resolveElapsed > 35 && (
          <p className="text-[10px] text-cinema-muted mt-3">
            Lâu hơn thường lệ — nguồn này có thể chậm. Thử đổi nguồn nếu quá 60 giây.
          </p>
        )}
      </div>
    );
  }

  if (playbackStatus === 'downloading') {
    return (
      <div className="aspect-video w-full rounded-xl bg-surface-dark flex flex-col items-center justify-center border border-white/10 p-6 text-center">
        <Download className="w-10 h-10 text-blue-400 animate-bounce mb-3" />
        <h3 className="text-base font-bold text-white mb-1">TorBox đang lưu vào bộ nhớ đệm</h3>
        <p className="text-xs text-cinema-subtle max-w-md mb-4">
          Nguồn phim chưa có sẵn trên máy chủ TorBox và đang được tải về. Trình phát sẽ tự động kích hoạt khi hoàn tất.
        </p>
        <div className="w-64 bg-surface-container rounded-full h-2 overflow-hidden mb-2">
          <div
            className="bg-blue-500 h-full transition-all duration-300"
            style={{ width: `${Math.max(5, downloadProgress)}%` }}
          />
        </div>
        <p className="text-xs font-mono text-cinema-subtle">{downloadProgress.toFixed(1)}%</p>
      </div>
    );
  }

  if (playbackStatus === 'error') {
    return (
      <div className="w-full space-y-4">
        <div className="aspect-video w-full rounded-xl bg-surface-dark flex flex-col items-center justify-center border border-wine-accent/30 p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-wine-accent/15 flex items-center justify-center text-amber-gold mb-3">
            <AlertCircle size={24} />
          </div>
          <h3 className="text-base font-bold text-white mb-1">Không thể phát nội dung</h3>
          <p className="text-sm text-cinema-subtle max-w-md mb-5">{errorMessage || 'Đã xảy ra lỗi khi chuẩn bị nguồn phát.'}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => {
                recoveryAttemptsRef.current = 0;
                recoveryInFlightRef.current = false;
                startPlaybackResolution(activeTokenRef.current);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition"
            >
              <RefreshCw size={14} />
              <span>Thử lại</span>
            </button>
            <button
              onClick={() => {
                if (typeof window !== 'undefined') {
                  localStorage.removeItem(selectedSourceKey);
                }
                setActiveToken('');
                activeTokenRef.current = '';
                recoveryAttemptsRef.current = 0;
                recoveryInFlightRef.current = false;
                void loadSources();
                setShowSources(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-primary hover:bg-amber-500 text-black text-sm font-semibold transition shadow-lg shadow-amber-primary/20"
            >
              {isLoadingSources ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
              <span>Chọn nguồn khác</span>
            </button>
          </div>
        </div>

        {/* Danh sách nguồn phát thay thế */}
        {showSources && (
          <div className="rounded-xl border border-white/10 bg-black/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Layers size={16} className="text-amber-gold" />
                <span>Danh sách nguồn phát thay thế</span>
              </h4>
              <span className="text-xs text-cinema-subtle font-mono">{sources.filter((s) => s.playable !== false).length} nguồn khả dụng</span>
            </div>

            {isLoadingSources && (
              <div className="flex items-center justify-center py-6 text-xs text-cinema-subtle gap-2">
                <Loader2 size={16} className="animate-spin text-amber-gold" />
                <span>Đang tải danh sách nguồn...</span>
              </div>
            )}

            {!isLoadingSources && sources.length === 0 && (
              <p className="p-3 text-xs text-cinema-subtle">Không tìm thấy nguồn thay thế nào.</p>
            )}

            <div className="max-h-80 space-y-1.5 overflow-y-auto">
              {groupPlaybackSources(sources).flatMap((group) => [
                <h5 key={`group-${group.key}`} className="sticky top-0 z-10 rounded-lg bg-surface-dark px-3 py-2 text-xs font-bold text-white">
                  {group.label} <span className="text-cinema-subtle">({group.sources.length})</span>
                </h5>,
                ...group.sources.map((src) => {
                const isActive = Boolean(src.sourceToken && src.sourceToken === activeToken);
                return (
                  <button
                    key={src.sourceToken}
                    onClick={() => {
                      if (src.playable === false) return;
                      recoveryAttemptsRef.current = 0;
                      recoveryInFlightRef.current = false;
                      startPlaybackResolution(src.sourceToken);
                    }}
                    disabled={src.playable === false}
                    className={`flex w-full flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      isActive ? 'bg-amber-primary/20 ring-1 ring-amber-primary/40' : 'bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    {src.resolution && (
                      <span className="rounded bg-amber-primary/20 px-2 py-0.5 font-bold text-amber-gold">
                        {resolutionLabel(src.resolution)}
                      </span>
                    )}
                    {src.codec && (
                      <span className="rounded bg-white/10 px-2 py-0.5 text-cinema-muted">
                        {src.codec.toUpperCase()}
                      </span>
                    )}
                    {src.hdr && (
                      <span className="rounded bg-amber-500/15 px-2 py-0.5 font-bold text-amber-400">
                        {src.hdr.toUpperCase()}
                      </span>
                    )}
                    {src.releaseSource && (
                      <span className="rounded bg-white/10 px-2 py-0.5 text-cinema-muted">
                        {src.releaseSource.toUpperCase()}
                      </span>
                    )}
                    {src.origin === 'yastream' && (
                      <span className="rounded bg-indigo-500/15 px-2 py-0.5 font-bold text-indigo-400">
                        KKPHIM / OPHIM
                      </span>
                    )}
                    {src.origin === 'vimo' && (
                      <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-bold text-emerald-400">
                        VIETSUB TRỰC TIẾP
                      </span>
                    )}
                    {typeof src.sizeBytes === 'number' && src.sizeBytes > 0 && (
                      <span className="text-cinema-subtle">{formatSize(src.sizeBytes)}</span>
                    )}
                    {typeof src.seeds === 'number' && (
                      <span className="text-cinema-subtle">{src.seeds} seed</span>
                    )}
                    {src.cached && (
                      <span className="rounded bg-green-500/15 px-2 py-0.5 font-bold text-green-400">
                        cached
                      </span>
                    )}
                    {src.playable === false && (
                      <span className="rounded bg-amber-primary/15 px-2 py-0.5 font-bold text-amber-gold">
                        {src.reasons?.[0] || 'không khuyến nghị'}
                      </span>
                    )}
                    {src.filename && (
                      <span className="truncate max-w-[240px] text-cinema-subtle text-[11px]">
                        {src.filename}
                      </span>
                    )}
                    {!src.resolution && !src.codec && !src.hdr && !src.releaseSource && !src.origin && !src.cached && !src.filename && (
                      <span className="rounded bg-white/10 px-2 py-0.5 text-cinema-subtle">
                        Nguồn phát dự phòng
                      </span>
                    )}
                  </button>
                );
              }),
              ])}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (playbackStatus === 'ready' && playUrl) {
    const movieData = {
      name: title,
      slug: contentRef,
      poster_url: poster,
      origin_name: title,
      quality: '4K/HD',
    };

    const episodeData = {
      name: season && episode ? `Mùa ${season} Tập ${episode}` : 'Full',
      slug: season && episode ? `s${season}e${episode}` : 'full',
    };

    const is4K = Number(candidate?.resolution) >= 2160;

    return (
      <div className="w-full space-y-2">
        {notice && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-primary/30 bg-amber-primary/10 px-4 py-2.5 text-xs leading-relaxed text-amber-gold">
            <span>{notice}</span>
            <button
              onClick={() => setNotice(null)}
              aria-label="Đóng thông báo"
              className="shrink-0 rounded-full px-2 py-0.5 font-bold hover:bg-white/10"
            >
              ✕
            </button>
          </div>
        )}
        <div ref={fullscreenTargetRef} className="ambient-fullscreen-shell relative">
          <div className="ambient-fullscreen-stage relative isolate w-full">
            <CinemaLayer mode={cinemaMode} video={videoEl} />
            <div className="ambient-fullscreen-frame relative aspect-video w-full rounded-xl overflow-hidden shadow-2xl bg-black border border-white/5">
          <VideoPlayer
            onCinemaChange={setCinemaMode}
            onVideoReady={setVideoEl}
            fullscreenTargetRef={fullscreenTargetRef}
            src={playUrl}
            reloadKey={reloadKey}
            onPlaybackFailure={recoverPlayback}
            onPlaybackProgress={handlePlaybackProgress}
            onDecodeOverload={handleDecodeOverload}
            movie={movieData}
            episode={episodeData}
            authToken={(session?.user as any)?.accessToken}
            durationSeconds={durationSeconds}
            subContext={{
              type,
              tmdbId,
              season,
              episode,
              playbackSessionId,
              ...(activeToken ? { sourceToken: activeToken } : {}),
            }}
            onPickAudio={pickAudio}
            activeAudioIndex={activeAudioIndex}
            pendingAudioIndex={pendingAudioIndex}
            startAt={startOffset}
            presentationShiftMs={presentationShiftMs}
            seekStartSupported={seekStartSupported}
            onSeekToPosition={requestSeekPosition}
            onCancelSeek={cancelSeekPosition}
            seekProgress={{ label: resolveStageLabel || null, percent: downloadProgress || null }}
          />
          {/* Live telemetry pills overlay (Stitch player pro) — display only,
              pointer-events-none so player controls stay clickable. */}
          <div className="pointer-events-none absolute left-4 top-3 z-20 flex items-center gap-2">
            <span className="flex items-center gap-1 rounded border border-amber-primary/40 bg-black/60 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-gold backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-amber-400"></span>
              {candidate?.resolution ? resolutionLabel(candidate.resolution) : is4K ? '4K' : 'HD'}
            </span>
            {candidate?.hdr ? (
              <span className="rounded border border-white/10 bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white/90 backdrop-blur-md">
                {candidate.hdr.toUpperCase()}
              </span>
            ) : (
              <span className="rounded border border-white/10 bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white/90 backdrop-blur-md">
                VISIONOS
              </span>
            )}
          </div>
          <div className="pointer-events-none absolute right-4 top-3 z-20">
            <div className="flex items-center gap-1.5 rounded-full border border-cyan-accent/30 bg-black/70 px-2.5 py-1 font-mono text-[10px] text-cyan-accent backdrop-blur-md">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400"></span>
              </span>
              360° AUDIO
            </div>
          </div>
            </div>
          </div>
        </div>
        {/* Telemetry strip: every pill is real source data (Stitch pro style) */}
        <div className="flex flex-wrap items-center gap-2 px-1 font-mono text-[11px]">
          {candidate?.resolution && (
            <span className="rounded bg-amber-primary/20 px-2 py-0.5 font-bold text-amber-gold ring-1 ring-amber-primary/30">
              {resolutionLabel(candidate.resolution)}
            </span>
          )}
          {candidate?.codec && (
            <span className="rounded bg-white/5 px-2 py-0.5 text-cinema-muted ring-1 ring-white/10">{candidate.codec.toUpperCase()}</span>
          )}
          {candidate?.hdr && (
            <span className="rounded bg-amber-primary/15 px-2 py-0.5 font-bold text-amber-gold ring-1 ring-amber-primary/20">
              {candidate.hdr.toUpperCase()}
            </span>
          )}
          {candidate?.releaseSource && (
            <span className="rounded bg-white/5 px-2 py-0.5 text-cinema-muted ring-1 ring-white/10">{candidate.releaseSource.toUpperCase()}</span>
          )}
          {typeof candidate?.sizeBytes === 'number' && candidate.sizeBytes > 0 && (
            <span className="rounded bg-white/5 px-2 py-0.5 text-cinema-subtle ring-1 ring-white/10">{formatSize(candidate.sizeBytes)}</span>
          )}
          {typeof candidate?.seeds === 'number' && (
            <span className="rounded bg-white/5 px-2 py-0.5 text-cinema-subtle ring-1 ring-white/10">{candidate.seeds} seed</span>
          )}
          <span className="rounded bg-white/5 px-2 py-0.5 text-cinema-subtle ring-1 ring-white/10">
            {isProd
              ? 'Chất lượng cao'
              : playMode === 'remux' ? 'Remux HLS (copy video)' : 'Direct stream'}
          </span>
          {candidate?.cached && (
            <span className="rounded bg-green-500/15 px-2 py-0.5 font-bold text-green-400 ring-1 ring-green-500/20">{isProd ? 'Sẵn sàng' : 'TorBox cached'}</span>
          )}
          <button
            onClick={togglePip}
            title="Chế độ PiP (Picture-in-Picture)"
            className="glass-button inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold text-amber-gold transition-all hover:text-white"
          >
            <PictureInPicture2 size={13} />
            <span>PiP</span>
          </button>
        </div>

        {fileName && (
          <div className="flex flex-col gap-1.5 px-1">
            <div className="flex items-center justify-between text-xs text-cinema-subtle">
              <span className="max-w-md truncate" title={fileName}>
                Tệp: {fileName}
              </span>
              <span className="rounded bg-white/5 px-2 py-0.5 text-cinema-subtle">
                {isProd
                  ? 'Phát trực tuyến'
                  : candidate?.releaseSource?.toLowerCase().includes('vimo') || candidate?.releaseSource?.toLowerCase().includes('yastream')
                    ? 'Vietsub Playback'
                    : playMode === 'direct'
                      ? 'Direct Playback'
                      : 'TorBox Playback'}
              </span>
            </div>
            {resolveElapsed >= 30 && (
              <div className="flex items-center justify-between rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-200/80 ring-1 ring-amber-500/20">
                <span>Nguồn này phản hồi chậm hơn dự kiến, bạn có muốn thử lại hoặc đổi nguồn?</span>
                <button 
                  onClick={() => window.location.reload()}
                  className="rounded bg-amber-500/20 px-2 py-1 font-bold text-amber-200 hover:bg-amber-500/30"
                >
                  Thử lại
                </button>
              </div>
            )}
          </div>
        )}

        <div className="px-1">
          <button
            onClick={() => (showSources ? setShowSources(false) : loadSources())}
            disabled={isLoadingSources}
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/15 disabled:opacity-50"
          >
            {isLoadingSources ? <Loader2 size={13} className="animate-spin" /> : <Layers size={13} />}
            <span>{showSources ? 'Ẩn danh sách nguồn' : 'Đổi nguồn / chọn 4K'}</span>
          </button>
        </div>

        {/* Pro episodes panel (Stitch player pro, TV only) — real season data */}
        {type === 'tv' && episodes.length > 0 && (
          <section id="episodes" className="glass-panel group relative mt-3 rounded-2xl border border-amber-primary/20 p-3.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-y-2 gap-x-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400"></span>
                <h2 className="font-syne text-xs font-bold uppercase tracking-wider text-white">
                  Danh Sách Tập Phim{seasonLabel ? ` (${seasonLabel})` : ''}
                </h2>
                {typeof currentEpisode === 'number' && (
                  <span className="shrink-0 rounded-full bg-amber-primary/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-gold ring-1 ring-amber-primary/30">
                    {isProd ? `Tập ${currentEpisode}` : `Tập ${currentEpisode}/${episodes.length}`}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                <span className="font-mono text-[11px] text-cyan-accent whitespace-nowrap">
                  {isProd ? `${episodes.length} tập` : `${episodes.length} tập (Stitch Pro)`}
                </span>
                <div className="hidden sm:flex gap-1">
                  <button
                    onClick={() => scrollEpisodes('left')}
                    aria-label="Tập trước"
                    className="flex h-6 w-6 items-center justify-center rounded-md bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={() => scrollEpisodes('right')}
                    aria-label="Tập tiếp"
                    className="flex h-6 w-6 items-center justify-center rounded-md bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
            <div
              ref={episodeScrollRef}
              className="hide-scrollbar relative flex gap-3 overflow-x-auto scroll-smooth pb-2 snap-x snap-mandatory touch-pan-x"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
            >
              {episodes.map((ep) => {
                const isActive = ep.episodeNumber === currentEpisode;
                return (
                  <Link
                    key={ep.episodeNumber}
                    href={ep.href}
                    scroll={false}
                    data-active={isActive}
                    ref={isActive ? activeCardRef : undefined}
                    onClick={(clickEvent) => {
                      // A new tab, a new window or "open in new tab" must keep
                      // working, so only a plain left click is intercepted.
                      if (clickEvent.defaultPrevented) return;
                      if (clickEvent.metaKey || clickEvent.ctrlKey || clickEvent.shiftKey || clickEvent.altKey) return;
                      if (clickEvent.button !== 0) return;
                      clickEvent.preventDefault();
                      if (ep.episodeNumber === currentEpisode) return;
                      setSwitchedEpisode(ep.episodeNumber);
                      // The address bar must stay truthful — a reload or a shared
                      // link opens this episode — but replaceState is not a
                      // navigation, so the player is left alone. replaceState
                      // rather than push: walking a season should not bury the
                      // page the viewer came from under 24 history entries.
                      if (typeof window !== 'undefined') {
                        window.history.replaceState(null, '', ep.href);
                      }
                    }}
                    className={`group w-44 shrink-0 overflow-hidden rounded-xl border transition snap-start ${
                      isActive
                        ? 'glass-panel border-amber-primary/60 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                        : 'border-white/10 bg-white/5 hover:border-white/30'
                    }`}
                  >
                    <div className="relative h-24 w-full bg-surface-container">
                      {ep.still ? (
                        <Image
                          src={ep.still}
                          alt={ep.name}
                          fill
                          sizes="176px"
                          className={`object-cover transition group-hover:opacity-100 ${
                            isActive ? 'opacity-100' : 'opacity-85'
                          }`}
                        />
                      ) : null}
                      <span className="absolute left-1.5 top-1.5 rounded border border-white/10 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-white/90">
                        {isProd ? `Tập ${ep.episodeNumber}` : `Tập ${ep.episodeNumber} (Internal)`}
                      </span>
                      {isActive && (
                        <span className="absolute bottom-1 right-1 rounded bg-amber-primary px-1.5 py-0.5 font-mono text-[9px] font-bold text-surface-dark">
                          ĐANG XEM
                        </span>
                      )}
                      {!isActive && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-md">
                            <Film size={14} />
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <p
                        className={`truncate text-[11px] font-bold ${
                          isActive ? 'text-amber-gold' : 'text-white'
                        }`}
                      >
                        {ep.episodeNumber}. {ep.name}
                      </p>
              <p className="truncate text-[9px] text-cinema-subtle">
                {(isProd && ep.overview && ep.overview.includes('Internal')) ? 'Chưa có mô tả.' : (ep.overview || 'Chưa có mô tả.')}
              </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {showSources && (
          <div className="max-h-80 space-y-1.5 overflow-y-auto rounded-xl border border-white/10 bg-black/40 p-2">
            {sources.length === 0 && (
              <p className="p-3 text-xs text-cinema-subtle">Không có nguồn nào.</p>
            )}
            {groupPlaybackSources(sources).flatMap((group) => [
                <h5 key={`group-${group.key}`} className="sticky top-0 z-10 rounded-lg bg-surface-dark px-3 py-2 text-xs font-bold text-white">
                  {group.label} <span className="text-cinema-subtle">({group.sources.length})</span>
                </h5>,
                ...group.sources.map((src) => {
              const isActive = Boolean(src.sourceToken && src.sourceToken === activeToken);
              return (
                <button
                  key={src.sourceToken}
                  onClick={() => {
                    if (src.playable === false) return;
                    setShowSources(false);
                    recoveryAttemptsRef.current = 0;
                    recoveryInFlightRef.current = false;
                    startPlaybackResolution(src.sourceToken);
                  }}
                  disabled={src.playable === false}
                  className={`flex w-full flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    isActive ? 'bg-primary/20 ring-1 ring-primary/40' : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  {src.resolution && (
                    <span className="rounded bg-primary/20 px-2 py-0.5 font-bold text-primary">
                      {resolutionLabel(src.resolution)}
                    </span>
                  )}
                  {src.codec && (
                    <span className="rounded bg-white/10 px-2 py-0.5 text-cinema-muted">
                      {src.codec.toUpperCase()}
                    </span>
                  )}
                  {src.hdr && (
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 font-bold text-amber-400">
                      {src.hdr.toUpperCase()}
                    </span>
                  )}
                  {src.releaseSource && (
                    <span className="rounded bg-white/10 px-2 py-0.5 text-cinema-muted">
                      {src.releaseSource.toUpperCase()}
                    </span>
                  )}
                  {src.origin === 'yastream' && (
                    <span className="rounded bg-indigo-500/15 px-2 py-0.5 font-bold text-indigo-400">
                      KKPHIM / OPHIM
                    </span>
                  )}
                  {src.origin === 'vimo' && (
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-bold text-emerald-400">
                      VIETSUB TRỰC TIẾP
                    </span>
                  )}
                  {typeof src.sizeBytes === 'number' && src.sizeBytes > 0 && (
                    <span className="text-cinema-subtle">{formatSize(src.sizeBytes)}</span>
                  )}
                  {typeof src.seeds === 'number' && (
                    <span className="text-cinema-subtle">{src.seeds} seed</span>
                  )}
                  {src.cached && (
                    <span className="rounded bg-green-500/15 px-2 py-0.5 font-bold text-green-400">
                      cached
                    </span>
                  )}
                  {src.playable === false && (
                    <span className="rounded bg-amber-primary/15 px-2 py-0.5 font-bold text-amber-gold">
                      {src.reasons?.[0] || 'không khuyến nghị'}
                    </span>
                  )}
                  {src.filename && (
                    <span className="truncate max-w-[240px] text-cinema-subtle text-[11px]">
                      {src.filename}
                    </span>
                  )}
                  {!src.resolution && !src.codec && !src.hdr && !src.releaseSource && !src.origin && !src.cached && !src.filename && (
                    <span className="rounded bg-white/10 px-2 py-0.5 text-cinema-subtle">
                      Nguồn phát dự phòng
                    </span>
                  )}
                </button>
              );
            }),
              ])}
          </div>
        )}
      </div>
    );
  }

  // Idle and ready-without-URL are transient (first mount, strict-mode
  // re-resolve): never leave a blank hole in the page.
  return (
    <div className="aspect-video w-full rounded-xl bg-surface-dark flex flex-col items-center justify-center border border-white/5 p-6 text-center">
      <Loader2 className="w-10 h-10 text-primary animate-spin mb-3" />
      <p className="text-cinema-muted text-sm font-medium">Đang tải trình phát…</p>
    </div>
  );
}
