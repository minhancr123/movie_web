import { shouldAutoplayAfterRebuild } from './playback-progress';

/** Retry a metadata-only native loader through MSE, never an already decoded
 * or explicitly failed stream. The caller pins the override to this source. */
export const canRetryNativeWithMse = (nativePreferred: boolean, mseSupported: boolean,
  readyState: number, hasBuffer: boolean, mediaError: number | null): boolean =>
  nativePreferred && mseSupported && readyState === 1 && !hasBuffer && !mediaError;

/** Snapshot intent before pause/load events from a replacement pipeline. */
export const restorePlayIntent = (hadPlayed: boolean, paused: boolean, userPaused: boolean, seekIntent: boolean | null) =>
  seekIntent ?? (shouldAutoplayAfterRebuild(hadPlayed, paused) && !userPaused);

/** An incidental rebuild must resume live playback, not the old resolve seed.
 * A new URL/origin/reload intent or changed target remains authoritative. */
export type PipelineCheckpoint = { delivery: string; requested: number | null; position: number };
export const pipelineRestoreTarget = (delivery: string, requested: number | null,
  previous: PipelineCheckpoint | null, history: number | null): number | null =>
  previous?.delivery === delivery && previous.requested === requested && Number.isFinite(previous.position)
    ? previous.position : requested ?? history;

type RestoreMedia = Pick<HTMLVideoElement,
  'readyState' | 'currentTime' | 'seeking' | 'pause' | 'addEventListener' | 'removeEventListener'>
  & Partial<Pick<HTMLVideoElement, 'buffered' | 'requestVideoFrameCallback' | 'cancelVideoFrameCallback'>>;

/** A finite element duration describes this HLS playlist, not the full-film UI.
 * Native HLS may expose no seekable/buffered ranges until currentTime requests
 * the destination. Do not wait for that download before issuing the seek.
 */
export const nativeSeekCovered = (video: Pick<HTMLVideoElement, 'readyState' | 'duration' | 'seekable' | 'buffered'>, target: number): boolean => {
  if (target <= 0) return true;
  if (video.readyState < 1) return false;
  if (Number.isFinite(video.duration) && target + 0.5 <= video.duration) return true;
  try {
    for (const ranges of [video.seekable, video.buffered]) {
      for (let i = 0; i < ranges.length; i++) {
        if (ranges.start(i) <= target && ranges.end(i) >= target + 0.5) return true;
      }
    }
  } catch { /* ranges can change while the native loader updates */ }
  return false;
};

/** Metadata or a currentTime assignment alone does not prove a seek landed. */
export const restoreBeforePlayback = (video: RestoreMedia, target: number, options: {
  covered?: () => boolean;
  ready: () => void;
  /** Resume decoding at an already-buffered seek target; does not settle UI. */
  prime?: () => void;
  /** Native HLS may not fetch its target while paused, so buffered remains
   * empty until play(). Coverage still has to come from the new playlist. */
  primeWhenCovered?: boolean;
  /** A fresh native decoder must load its initial sample before an exact seek.
   * Seeking at HAVE_METADATA can leave WebKit permanently seeking with no
   * buffered media. Keep preload active, but never play the old origin. */
  waitForInitialData?: boolean;
  failed: () => void;
  timeoutMs?: number;
}) => {
  let cancelled = false;
  let assigned = false;
  let seekFinished = false;
  let decodedTarget = false;
  let stableSince: number | null = null;
  let frameCallback: number | undefined;
  let assignedAt = 0;
  let primed = false;
  const events = ['loadedmetadata', 'loadeddata', 'progress', 'seeked', 'canplay', 'timeupdate'];
  let timer: ReturnType<typeof setTimeout>;
  let poll: ReturnType<typeof setInterval>;
  const cleanup = () => {
    cancelled = true;
    clearTimeout(timer);
    clearInterval(poll);
    if (frameCallback !== undefined) video.cancelVideoFrameCallback?.(frameCallback);
    for (const event of events) video.removeEventListener(event, check);
  };
  const check = (event?: Event) => {
    if (cancelled || video.readyState < 1 || (options.covered && !options.covered())) return;
    if (!assigned) {
      if (options.waitForInitialData && target > 0 && video.readyState < 2) return;
      if (!video.seeking && Math.abs(video.currentTime - target) <= 0.5) {
        if (video.readyState < 2) {
          if (options.primeWhenCovered && options.prime) {
            assigned = true;
            assignedAt = performance.now();
          }
          return;
        }
        cleanup(); options.ready(); return;
      }
      assigned = true;
      assignedAt = performance.now();
      try { video.currentTime = target; } catch { assigned = false; return; }
      // Some browsers update currentTime before dispatching seeking/seeked.
      // Do not treat that synchronous property change as a decoded frame.
      return;
    }
    if (event?.type === 'seeked') seekFinished = true;
    // Some decoders retain HAVE_METADATA while a paused seek is pending,
    // even after the destination has arrived. Let the existing play intent
    // drive decoding once, without treating play() as proof the seek landed.
    // Native WebKit can withhold ALL buffered ranges until play(); requiring
    // a buffer there creates a paused -> no download -> no play deadlock.
    if (!primed && options.prime && Math.abs(video.currentTime - target) <= 0.5
        && performance.now() - assignedAt >= 750) {
      try {
        if (options.primeWhenCovered && options.covered?.()) {
          primed = true;
          options.prime();
        }
        const ranges = video.buffered;
        for (let i = 0; !primed && ranges && i < ranges.length; i++) {
          if (ranges.start(i) <= target && ranges.end(i) >= target + 0.5) {
            primed = true;
            options.prime();
            break;
          }
        }
      } catch { /* the next poll rechecks mutable ranges */ }
    }
    // WebKit can still present the old frame while the seek is in progress.
    if (video.seeking || video.readyState < 2 || Math.abs(video.currentTime - target) > 0.5) {
      stableSince = null;
      return;
    }
    // MSE can reach hls.startLoad(target) before a seeked event is observable.
    // Confirm a decoded destination frame, or a stable, playable buffered
    // destination. A currentTime assignment/metadata alone is never enough.
    let bufferedTarget = false;
    try {
      const ranges = video.buffered;
      for (let i = 0; ranges && i < ranges.length; i++) {
        if (ranges.start(i) <= video.currentTime && ranges.end(i) >= video.currentTime + 0.1) bufferedTarget = true;
      }
    } catch { /* ranges can change during append */ }
    if (video.readyState >= 3 && bufferedTarget) stableSince ??= performance.now();
    else stableSince = null;
    if (!seekFinished && !decodedTarget && (stableSince === null || performance.now() - stableSince < 250)) return;
    cleanup();
    options.ready();
  };
  video.pause();
  for (const event of events) video.addEventListener(event, check);
  const watchFrame = () => {
    if (cancelled || !video.requestVideoFrameCallback) return;
    frameCallback = video.requestVideoFrameCallback((_now, metadata) => {
      frameCallback = undefined;
      if (cancelled) return;
      decodedTarget = Math.abs(metadata.mediaTime - target) <= 0.5;
      check();
      if (!cancelled) watchFrame();
    });
  };
  watchFrame();
  poll = setInterval(check, 100);
  timer = setTimeout(() => { cleanup(); options.failed(); }, options.timeoutMs ?? 30000);
  check();
  return cleanup;
};
