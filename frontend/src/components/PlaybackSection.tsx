'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { Loader2, AlertCircle, Key, RefreshCw, CheckCircle2, Download, Film, Layers, PictureInPicture2 } from 'lucide-react';
import VideoPlayer from '@/components/VideoPlayer';
import CinemaLayer, { type CinemaMode } from '@/components/CinemaLayer';

/** Mirrors PLAYBACK_STARTUP_BUFFER_SECONDS on the server, for the wait copy. */
const STARTUP_BUFFER_HINT = 15;

/** Server resolve phases (GET /playback/resolve/:id/stage) in plain words. */
const RESOLVE_STAGE_LABELS: Record<string, string> = {
  detail: 'Đang lấy thông tin phim',
  sources: 'Đang tìm nguồn chiếu',
  rank: 'Đang chấm điểm nguồn',
  reuse: 'Đang kiểm tra phiên cũ',
  prepare: 'Đang chuẩn bị link TorBox',
  link: 'Đang lấy link tải',
  probe: 'Đang đọc thông tin file',
  remux: 'Đang khởi động luồng',
  buffer: 'Đang đệm những giây đầu',
  warm: 'Đang đệm thêm',
};

const formatResolveStage = (stage: string, detail: string): string => {
  const base = RESOLVE_STAGE_LABELS[stage] || 'Đang chuẩn bị nguồn phát';
  return detail ? `${base} (${detail})` : base;
};
import { providerAPI, playbackAPI } from '@/lib/api';
import { detectCapabilities } from '@/lib/capabilities';
import type { PlayerEpisode } from '@/lib/catalog';

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
}: PlaybackSectionProps) {
  const { data: session, status: authStatus } = useSession();

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
  const [cinemaMode, setCinemaMode] = useState<CinemaMode>('off');
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [candidate, setCandidate] = useState<SourceCandidate | null>(null);
  const [sources, setSources] = useState<SourceCandidate[]>([]);
  const [showSources, setShowSources] = useState<boolean>(false);
  const [isLoadingSources, setIsLoadingSources] = useState<boolean>(false);
  const [activeToken, setActiveToken] = useState<string>('');
  const [playbackSessionId, setPlaybackSessionId] = useState<string>('');
  // Preferred embedded audio track (ffprobe order). Survives re-resolves via ref.
  const [activeAudioIndex, setActiveAudioIndex] = useState<number | null>(null);
  const activeAudioIndexRef = useRef<number | null>(null);

  const pickAudio = useCallback(
    (index: number) => {
      if (index === activeAudioIndexRef.current) return;
      setActiveAudioIndex(index);
      activeAudioIndexRef.current = index;
      // Same release, different audio: keep the current stream on screen while
      // the new track's session warms up, then reload and resume via history.
      void startPlaybackResolutionRef.current(activeTokenRef.current, index, {
        preservePlayer: true,
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
  // Latest-value mirrors so stable callbacks never close over stale state.
  const activeTokenRef = useRef<string>('');
  const startPlaybackResolutionRef = useRef<
    (
      sourceToken?: string,
      audioIndex?: number,
      options?: { preservePlayer?: boolean },
    ) => Promise<void>
  >(async () => {});
  const loadSourcesRef = useRef<() => Promise<void>>(async () => {});

  const selectedSourceKey = `playback:selectedSource:${type}:${tmdbId}:${season ?? 'movie'}:${episode ?? 'full'}`;

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
    void startPlaybackResolutionRef
      .current(
        activeTokenRef.current,
        activeAudioIndexRef.current ?? undefined,
        { preservePlayer: true },
      )
      .finally(() => {
        recoveryInFlightRef.current = false;
      });
  }, [selectedSourceKey]);

  // Isolated stalls must not accumulate: steady progress clears the counter.
  const handlePlaybackProgress = useCallback(() => {
    if (recoveryAttemptsRef.current !== 0) recoveryAttemptsRef.current = 0;
  }, []);

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

  useEffect(() => {
    return () => {
      clearPoll();
      clearStagePoll();
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

  const startPlaybackResolution = useCallback(async (
    sourceToken?: string,
    audioIndex?: number,
    options?: { preservePlayer?: boolean },
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

    const requestKey = `${resolvedSourceToken}|${resolvedAudioIndex ?? ''}`;
    if (resolveInFlightRef.current === requestKey) return;
    resolveInFlightRef.current = requestKey;

    clearPoll();
    clearStagePoll();
    setErrorMessage('');
    setResolveElapsed(0);
    setResolveStageLabel('');
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
      try {
        const r = await playbackAPI.getResolveStage(resolveId);
        const st = r.data?.data;
        if (st?.stage) setResolveStageLabel(formatResolveStage(st.stage, st.detail || ''));
      } catch {
        // 404 = unknown/expired id: keep the last label, the resolve HTTP
        // response itself is still coming and carries the real outcome.
      }
    };
    void pollResolveStage();
    // Local handle: the 4xx-retry path below re-enters this function, and the
    // outer finally must not kill the retry's poll.
    const stageTimer = setInterval(pollResolveStage, 1500);
    stagePollRef.current = stageTimer;

    try {
      const caps = detectCapabilities();
      const res = await playbackAPI.resolve({
        type,
        tmdbId,
        season: season ?? undefined,
        episode: episode ?? undefined,
        capabilities: caps,
        resolveId,
        ...(resolvedSourceToken ? { sourceToken: resolvedSourceToken } : {}),
        ...(resolvedAudioIndex !== null && resolvedAudioIndex !== undefined
          ? { audioIndex: resolvedAudioIndex }
          : {}),
      });

      const data = res.data?.data;
      if (!data) {
        throw new Error('Dữ liệu phản hồi không hợp lệ');
      }

      setCandidate(data.candidate || null);
      setPlaybackSessionId(typeof data.sessionId === 'string' ? data.sessionId : '');
      setActiveToken(resolvedSourceToken);
      activeTokenRef.current = resolvedSourceToken;
      if (sourceToken && typeof window !== 'undefined') {
        localStorage.setItem(selectedSourceKey, sourceToken);
      }
      if (typeof data.audioIndex === 'number') {
        setActiveAudioIndex(data.audioIndex);
        activeAudioIndexRef.current = data.audioIndex;
      }

      if (data.mode === 'direct' && data.url) {
        applyPlayUrl(data.url);
        setFileName(data.fileName || '');
        setPlayMode('direct');
        setDurationSeconds(null);
        setPlaybackStatus('ready');
      } else if (data.mode === 'remux' && data.playlistUrl) {
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
              : 15;
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
                recoverPlayback('Luồng remux đã ngừng tạo dữ liệu.');
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
      const status = err.response?.status;
      const message = err.response?.data?.message || err.message || 'Không thể chuẩn bị nguồn phát';

      if (!sourceToken && resolvedSourceToken && status && status >= 400 && status < 500 && typeof window !== 'undefined') {
        localStorage.removeItem(selectedSourceKey);
        setActiveToken('');
        activeTokenRef.current = '';
        // Released before the retry so the follow-up is never mistaken for a
        // duplicate of the request that just failed.
        resolveInFlightRef.current = null;
        startPlaybackResolution('', undefined, options);
        return;
      }

      if (status === 401 && (err.response?.data?.code === 'invalid_token' || err.response?.data?.code === 'no_token')) {
        setPlaybackStatus('needs_provider');
        setKeyError(message);
      } else {
        setPlaybackStatus('error');
        // The 422 carries why each top release was rejected — surface the
        // first reason so a dead end is diagnosable instead of a blank wall.
        const rejected = err.response?.data?.rejected;
        const hint =
          Array.isArray(rejected) && rejected[0]?.reasons?.[0]
            ? ` (VD: ${rejected[0].reasons[0]})`
            : '';
        setErrorMessage(`${message}${hint}`);
      }
    } finally {
      if (stagePollRef.current === stageTimer) clearStagePoll();
      if (resolveInFlightRef.current === requestKey) resolveInFlightRef.current = null;
    }
  }, [type, tmdbId, season, episode, selectedSourceKey, recoverPlayback]);

  // Keep the stable mirrors in sync after every render.
  startPlaybackResolutionRef.current = startPlaybackResolution;

  const loadSources = useCallback(async () => {
    setIsLoadingSources(true);
    try {
      const res = await playbackAPI.listSources({
        type,
        tmdbId,
        season: season ?? undefined,
        episode: episode ?? undefined,
        capabilities: detectCapabilities(),
      });
      setSources(res.data?.data?.sources || []);
      setShowSources(true);
    } catch (err: any) {
      setErrorMessage(err.response?.data?.message || 'Không tải được danh sách nguồn');
    } finally {
      setIsLoadingSources(false);
    }
  }, [type, tmdbId, season, episode]);

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
        startPlaybackResolution();
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
  }, [authStatus, startPlaybackResolution]);

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
      startPlaybackResolution();
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
              <span className="text-xs text-cinema-subtle font-mono">{sources.length} nguồn khả dụng</span>
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
              {sources.map((src) => {
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
                  </button>
                );
              })}
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
        <div className="relative">
          <CinemaLayer mode={cinemaMode} video={videoEl} />
          <div className="relative aspect-video w-full rounded-xl overflow-hidden shadow-2xl bg-black border border-white/5">
          <VideoPlayer
            onCinemaChange={setCinemaMode}
            onVideoReady={setVideoEl}
            src={playUrl}
            reloadKey={reloadKey}
            onPlaybackFailure={recoverPlayback}
            onPlaybackProgress={handlePlaybackProgress}
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
            {playMode === 'remux' ? 'Remux HLS (copy video)' : 'Direct stream'}
          </span>
          {candidate?.cached && (
            <span className="rounded bg-green-500/15 px-2 py-0.5 font-bold text-green-400 ring-1 ring-green-500/20">TorBox cached</span>
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
          <div className="flex items-center justify-between px-1 text-xs text-cinema-subtle">
            <span className="max-w-md truncate">Tệp: {fileName}</span>
            <span className="rounded bg-white/5 px-2 py-0.5 text-cinema-subtle">TorBox Playback</span>
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
          <section id="episodes" className="glass-panel mt-3 rounded-2xl border border-amber-primary/20 p-3.5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400"></span>
                <h2 className="font-syne text-xs font-bold uppercase tracking-wider text-white">
                  Danh Sách Tập Phim{seasonLabel ? ` (${seasonLabel})` : ''}
                </h2>
                {typeof activeEpisode === 'number' && (
                  <span className="rounded-full bg-amber-primary/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-gold ring-1 ring-amber-primary/30">
                    Tập {activeEpisode}/{episodes.length}
                  </span>
                )}
              </div>
              <span className="font-mono text-[11px] text-cyan-accent">
                {episodes.length} tập
              </span>
            </div>
            <div
              className="hide-scrollbar flex gap-3 overflow-x-auto pb-2"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {episodes.map((ep) => {
                const isActive = ep.episodeNumber === activeEpisode;
                return (
                  <Link
                    key={ep.episodeNumber}
                    href={ep.href}
                    scroll={false}
                    className={`group w-44 shrink-0 overflow-hidden rounded-xl border transition ${
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
                        Tập {ep.episodeNumber}
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
                        {ep.overview || 'Chưa có mô tả.'}
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
            {sources.map((src) => {
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
                </button>
              );
            })}
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
