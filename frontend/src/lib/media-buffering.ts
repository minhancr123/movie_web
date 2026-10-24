type BufferingMedia = Pick<HTMLVideoElement, 'paused' | 'ended' | 'addEventListener' | 'removeEventListener'>;

/** A delayed waiting event must not leave a spinner over a paused video.
 * Internal pauses during position restoration keep the startup indicator. */
export function observeBuffering(video: BufferingMedia, loading: (value: boolean) => void,
  restoring: () => boolean, delayMs = 600): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const waiting = () => {
    clear();
    if (video.paused || video.ended) return;
    timer = setTimeout(() => {
      timer = undefined;
      // Safari may pause between `waiting` and this delayed callback.
      if (!video.paused && !video.ended) loading(true);
    }, delayMs);
  };
  const pause = () => {
    clear();
    if (!restoring()) loading(false);
  };
  const ready = () => { clear(); loading(false); };
  const events = [['waiting', waiting], ['pause', pause], ['playing', ready],
    ['canplay', ready], ['ended', ready]] as const;
  for (const [name, handler] of events) video.addEventListener(name, handler);
  return () => {
    clear();
    for (const [name, handler] of events) video.removeEventListener(name, handler);
  };
}
