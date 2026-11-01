type BufferingMedia = Pick<HTMLVideoElement, 'paused' | 'ended' | 'addEventListener' | 'removeEventListener'>;

/** Repeated waiting/canplay events are not proof that frames progressed.
 * Only the progress path may renew an already armed recovery deadline. */
export function armStallDeadline(slot: { current: ReturnType<typeof setTimeout> | undefined },
  fire: () => void, delayMs: number, progressed = false): boolean {
  if (slot.current !== undefined && !progressed) return false;
  if (slot.current !== undefined) clearTimeout(slot.current);
  slot.current = setTimeout(() => { slot.current = undefined; fire(); }, delayMs);
  return true;
}

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

/** A decoder rejection can close MSE without hls.js marking its event fatal.
 * Buffered data and paused=true do not make that source usable again. */
export function observeDecoderFailure(
  video: Pick<HTMLVideoElement, 'error' | 'addEventListener' | 'removeEventListener'>,
  fail: () => void,
): () => void {
  let failed = false;
  const error = () => {
    if (failed || (video.error?.code !== 3 && video.error?.code !== 4)) return;
    failed = true;
    fail();
  };
  video.addEventListener('error', error);
  return () => video.removeEventListener('error', error);
}
