/**
 * Pure playback-position helpers (no DOM): resume, seek clamping, duration.
 *
 * Two real bugs live behind these:
 *  - Setting `video.currentTime` before the element has metadata throws
 *    InvalidStateError, which used to abort the resume handler mid-flight and
 *    strand playback at 0 ("pause a while -> restarts from the beginning").
 *  - While a remux is still filling, its EVENT playlist has no ENDLIST, so
 *    `video.duration` is Infinity and anything past the written head is
 *    unseekable ("can't skip to the middle").
 */

/** Resume position from saved history, or null when playback starts at 0. */
export const computeResumeAt = (
  savedProgress: unknown,
  duration: number,
): number | null => {
  const progress =
    typeof savedProgress === 'number' && Number.isFinite(savedProgress)
      ? savedProgress
      : 0;
  if (progress <= 1) return null;
  // Back off 2s so a reload never lands on the exact broken fragment.
  const resumeAt = Math.max(0, progress - 2);
  if (duration > 0 && Number.isFinite(duration)) {
    return Math.min(resumeAt, Math.max(duration - 5, 0));
  }
  return resumeAt;
};

/**
 * Clamp a seek target to the written playlist head. An unknown head (NaN)
 * means "no information" and the target passes through untouched.
 */
export const clampSeekToHead = (
  target: number,
  headEnd: number,
): { time: number; clamped: boolean } => {
  if (!Number.isFinite(target) || target < 0) return { time: 0, clamped: true };
  if (!Number.isFinite(headEnd)) return { time: target, clamped: false };
  if (target > headEnd - 2) return { time: Math.max(0, headEnd - 5), clamped: true };
  return { time: target, clamped: false };
};

export type SeekTarget =
  | { kind: 'direct'; localTime: number; clamped: boolean }
  | { kind: 'reresolve'; at: number };

export type ResumePlan =
  | { kind: 'none' }
  | { kind: 'direct'; at: number }
  | { kind: 'seek-resolve'; at: number };
/**
 * How to resume into a (possibly still-filling) playlist.
 *
 * - `resumeAt`: desired display position, or null for "start at 0".
 * - `head`: written playlist head in seconds (NaN = unknown yet).
 * - `finished`: playlist carries ENDLIST (nothing more is coming).
 * - `canSeekResolve`: the parent can open a session beginning at a position.
 *
 * Restoring blindly past the written head makes hls.js snap back to ~0
 * ("pause a while -> restarts from the beginning"), so an unfilled target
 * re-resolves from there instead; a finished-but-shorter playlist clamps.
 */
export const planResume = (args: {
  resumeAt: number | null;
  head: number;
  finished: boolean;
  canSeekResolve: boolean;
}): ResumePlan => {
  const { resumeAt, head, finished, canSeekResolve } = args;
  if (resumeAt === null) return { kind: 'none' };
  if (Number.isFinite(head)) {
    if (!finished && resumeAt > head - 2 && canSeekResolve) {
      return { kind: 'seek-resolve', at: resumeAt };
    }
    if (finished) {
      return { kind: 'direct', at: Math.min(resumeAt, Math.max(0, head - 5)) };
    }
  }
  return { kind: 'direct', at: resumeAt };
};

export interface DroppedFramesSample {
  decoded: number;
  dropped: number;
}

/**
 * Whether decode is falling behind enough to step down a rendition.
 *
 * Browser caps (canPlayType/isTypeSupported) report decodability, never
 * speed: a machine can "support" 4K HEVC via a slow software decoder and
 * then lag every heavy title with audio permanently ahead of the picture
 * (subs, drawn on the media clock, read early against the late picture
 * too). No stall watchdog fires because currentTime keeps advancing.
 *
 * Judged over one sampling window (caller diffs getVideoPlaybackQuality):
 * needs a warmed-up baseline plus both an absolute and a relative dropped
 * count, so a couple of startup drops never trigger a downgrade.
 */
export const shouldDowngradeForDropped = (
  prev: DroppedFramesSample,
  next: DroppedFramesSample,
): boolean => {
  const decodedDelta = next.decoded - prev.decoded;
  const droppedDelta = next.dropped - prev.dropped;
  if (!(decodedDelta > 0) || droppedDelta < 0) return false;
  // ~10s of 24fps: don't judge a cold pipeline or a short window.
  if (decodedDelta < 240) return false;
  if (droppedDelta < 60) return false;
  return droppedDelta / (decodedDelta + droppedDelta) > 0.25;
};

/**
 * Whether a rebuilt pipeline may press play by itself.
 *
 * A fresh mount always tries (the tap-to-play prompt covers the blocked
 * case). But a rebuild of a player the viewer had paused — recovery after a
 * dead session, a seek made while paused — must stay paused: auto-playing
 * shouts over whatever they switched to and reads as "it plays by itself".
 */
export const shouldAutoplayAfterRebuild = (
  hadPlayedBefore: boolean,
  wasPausedBeforeTeardown: boolean,
): boolean => !hadPlayedBefore || !wasPausedBeforeTeardown;
/**
 * Where a seek should go on a (possibly truncated) remux timeline.
 *
 * - `startAt`: display offset this session began at (0 = from the start).
 * - `headLocal`: written playlist head in session-local seconds (NaN unknown).
 * - `canReresolve`: the parent can start a seek-from-here session.
 *
 * Targets inside the written window play instantly; targets outside ask the
 * server for a session beginning at the target instead of stalling on
 * segments that do not exist yet.
 */
export const decideSeekTarget = (args: {
  target: number;
  startAt: number;
  headLocal: number;
  canReresolve: boolean;
}): SeekTarget => {
  const { startAt, headLocal, canReresolve } = args;
  const target = Number.isFinite(args.target) ? Math.max(0, args.target) : 0;
  const headDisplay = Number.isFinite(headLocal) ? startAt + headLocal : NaN;
  const beforeStart = target < Math.max(0, startAt - 1);
  const pastHead = Number.isFinite(headDisplay) && target > headDisplay - 2;
  if ((beforeStart || pastHead) && canReresolve) {
    return { kind: 'reresolve', at: Math.floor(target) };
  }
  if (!Number.isFinite(headDisplay)) {
    return { kind: 'direct', localTime: Math.max(0, target - startAt), clamped: false };
  }
  const clampedDisplay = Math.min(target, Math.max(0, headDisplay - 2));
  return {
    kind: 'direct',
    localTime: Math.max(0, clampedDisplay - startAt),
    clamped: clampedDisplay < target,
  };
};

/**
 * Finite duration for the seek bar and time readout. Live EVENT playlists
 * report Infinity until the remux completes; fall back to the server's
 * estimate (probe duration, else title runtime), else 0 (slider uses its
 * own fallback max).
 */
export const pickDisplayDuration = (
  videoDuration: number,
  estimated: number | null | undefined,
): number => {
  if (Number.isFinite(videoDuration) && videoDuration > 0 && videoDuration !== Infinity) {
    return videoDuration;
  }
  if (typeof estimated === 'number' && Number.isFinite(estimated) && estimated > 0) {
    return estimated;
  }
  return 0;
};

/**
 * Seconds of runway kept before the position a new audio session starts at, so
 * the resume lands inside written bytes rather than exactly on the first
 * segment boundary. Matches computeResumeAt's back-off.
 */
const AUDIO_SWITCH_BACKOFF = 2;

/**
 * Below this, a switch is close enough to the opening that starting the new
 * session from the beginning costs nothing and keeps the request simpler.
 */
const AUDIO_SWITCH_MIN = 10;

/**
 * Where the session for a newly chosen audio track has to begin.
 *
 * Each audio track gets its own remux, and that remux writes from wherever it
 * is told to. Handing it the *session's origin* restarts the film there: a
 * viewer forty minutes into a from-the-start session gets a stream whose
 * written head is seconds old, the player resumes to forty minutes against
 * bytes that will not exist for another forty, and the switch reads as "the
 * stream never reloaded". Only the live playhead keeps the new track lined up
 * with what is on screen.
 *
 * The session origin is the floor, not the answer: it is the one position
 * known to be valid when no timeupdate has landed yet (a switch made in the
 * first moments after a seek), and a seek-started session must never be
 * rebuilt from zero.
 */
export const audioSwitchStartAt = (args: {
  /** Live playhead in full-film seconds (display time, not element time). */
  playhead: number;
  /** Origin of the session now playing; 0 when it runs from the start. */
  sessionStart: number;
}): number => {
  const sane = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const at = Math.max(sane(args.playhead), sane(args.sessionStart));
  if (at < AUDIO_SWITCH_MIN) return 0;
  return Math.max(0, Math.floor(at - AUDIO_SWITCH_BACKOFF));
};

/**
 * The source-timeline moment a subtitle cue should be looked up for.
 *
 * An fMP4 timeline starts at the first *decode* timestamp. With B-frames the
 * first frame is presented `has_b_frames` frames after it is decoded, so the
 * whole remux sits that far ahead of source time — 167ms for a 4-B-frame 24fps
 * release. Audio is carried along identically, so lip sync is unaffected and
 * this hides well; but subtitle cues, embedded or sidecar, are written against
 * the source, so every line arrives early by exactly that much unless it is
 * taken back out here.
 *
 * `delay` stays on top as the viewer's own nudge for a mistimed release.
 */
export const subtitleLookupTime = (args: {
  /** Display offset the session began at (0 = from the start). */
  sessionStart: number;
  /** The media element's own clock. */
  elementTime: number;
  /** Viewer's manual subtitle offset, seconds. */
  delay: number;
  /** Server-reported reorder lead; anything unusable means no correction. */
  presentationShiftMs: unknown;
}): number => {
  const shift = Number(args.presentationShiftMs);
  const lead = Number.isFinite(shift) && shift > 0 ? shift / 1000 : 0;
  const at = args.sessionStart + args.elementTime + args.delay - lead;
  // Rounded to the millisecond: the raw subtraction leaves float dust that
  // makes cue boundaries flicker.
  return Math.max(0, Math.round(at * 1000) / 1000);
};
