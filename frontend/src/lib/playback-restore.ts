import { shouldAutoplayAfterRebuild } from './playback-progress';

/** Snapshot intent before pause/load events from a replacement pipeline. */
export const restorePlayIntent = (hadPlayed: boolean, paused: boolean, userPaused: boolean, seekIntent: boolean | null) =>
  seekIntent ?? (shouldAutoplayAfterRebuild(hadPlayed, paused) && !userPaused);

type RestoreMedia = Pick<HTMLVideoElement,
  'readyState' | 'currentTime' | 'seeking' | 'pause' | 'addEventListener' | 'removeEventListener'>;

/** Metadata or a currentTime assignment alone does not prove a seek landed. */
export const restoreBeforePlayback = (video: RestoreMedia, target: number, options: {
  covered?: () => boolean;
  ready: () => void;
  failed: () => void;
  timeoutMs?: number;
}) => {
  let cancelled = false;
  let assigned = false;
  let seekFinished = false;
  const events = ['loadedmetadata', 'loadeddata', 'progress', 'seeked', 'canplay', 'timeupdate'];
  let timer: ReturnType<typeof setTimeout>;
  const cleanup = () => {
    cancelled = true;
    clearTimeout(timer);
    for (const event of events) video.removeEventListener(event, check);
  };
  const check = (event?: Event) => {
    if (cancelled || video.readyState < 1 || (options.covered && !options.covered())) return;
    if (!assigned) {
      if (!video.seeking && Math.abs(video.currentTime - target) <= 0.5) {
        if (video.readyState < 2) return;
        cleanup(); options.ready(); return;
      }
      try { video.currentTime = target; assigned = true; } catch { return; }
      // Some browsers update currentTime before dispatching seeking/seeked.
      // Do not treat that synchronous property change as a decoded frame.
      return;
    }
    if (event?.type === 'seeked') seekFinished = true;
    // WebKit can still present the old frame while the seek is in progress.
    if (!seekFinished || video.seeking || video.readyState < 2 || Math.abs(video.currentTime - target) > 0.5) return;
    cleanup();
    options.ready();
  };
  video.pause();
  for (const event of events) video.addEventListener(event, check);
  timer = setTimeout(() => { cleanup(); options.failed(); }, options.timeoutMs ?? 30000);
  check();
  return cleanup;
};
