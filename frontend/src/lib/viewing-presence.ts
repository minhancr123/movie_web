export type ViewingReport = { state: 'playing' | 'paused' | 'buffering' | 'ended'; position: number };
type Media = Pick<HTMLVideoElement, 'paused' | 'ended' | 'seeking' | 'currentTime' | 'addEventListener' | 'removeEventListener'>;

/** Observe the media clock, including browsers that keep readyState at 2
 * while frames are playing. State changes are immediate; progress is batched. */
export function observeViewing(video: Media, send: (report: ViewingReport) => void,
  options: { offset?: () => number; now?: () => number; every?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>; cancel?: typeof clearInterval } = {}) {
  const now = options.now || Date.now;
  let progressAt = -Infinity, previousTime = video.currentTime, lastSent = -Infinity;
  let state: ViewingReport['state'] | undefined;
  const report = (event?: Event) => {
    const at = now();
    const advanced = video.currentTime > previousTime + 0.02;
    previousTime = video.currentTime;
    if ((advanced || event?.type === 'playing') && !video.paused && !video.seeking) progressAt = at;
    if (event?.type === 'waiting' || video.seeking) progressAt = -Infinity;
    const next = video.ended ? 'ended' : video.paused ? 'paused'
      : !video.seeking && at - progressAt < 8000 ? 'playing' : 'buffering';
    if (next !== state || at - lastSent >= 15000) {
      state = next; lastSent = at;
      send({ state: next, position: Math.max(0, (options.offset?.() || 0) + video.currentTime) });
    }
  };
  const events = ['playing', 'timeupdate', 'pause', 'waiting', 'ended', 'seeking', 'seeked'];
  events.forEach(event => video.addEventListener(event, report));
  report();
  const timer = (options.every || setInterval)(report, 5000);
  return () => {
    (options.cancel || clearInterval)(timer);
    events.forEach(event => video.removeEventListener(event, report));
  };
}
