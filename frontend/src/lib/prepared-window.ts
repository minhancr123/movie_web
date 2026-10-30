/** A bounded fMP4 window can have video beyond the last audio packet. MSE's
 * common buffered range then ends before duration and `ended` never fires.
 * Preserve the current absolute frame instead of waiting for that event. */
export function stalledWindowAt(origin: number, localTime: number, fullDuration: number,
  windowSeconds: number, bufferedEnd: number, finishedEnd?: number): number | null {
  if (![origin, localTime, fullDuration, windowSeconds, bufferedEnd, finishedEnd].every(Number.isFinite)
    || windowSeconds <= 0 || Number(finishedEnd) < windowSeconds - 0.5
    || localTime < windowSeconds - 0.5 || bufferedEnd < localTime - 0.1
    || bufferedEnd - localTime > 0.25 || origin + localTime >= fullDuration - 2) return null;
  return Math.max(0, origin + localTime);
}

/** Predict the next window from the server's budget, not a growing EVENT head. */
export function prepareWindowAt(origin: number, localTime: number, fullDuration: number, windowSeconds: number, finishedEnd?: number): number | null {
  const end = Number.isFinite(finishedEnd) && Number(finishedEnd) > 0 ? Number(finishedEnd) : windowSeconds;
  if (![origin, localTime, fullDuration, end].every(Number.isFinite) || windowSeconds <= 0 || end < 3 || fullDuration <= 0) return null;
  if (origin + end >= fullDuration - 2 || localTime < end - Math.min(45, end / 2)) return null;
  return Math.max(0, origin + end - 1);
}

export function preparedWindowCovers(data: { startOffset?: number; windowSeconds?: number; durationSeconds?: number }, target: number): boolean {
  const origin = Number(data.startOffset ?? 0), duration = Number(data.windowSeconds);
  const remaining = Number(data.durationSeconds) > 0 ? Number(data.durationSeconds) - target : Infinity;
  return [origin, duration, target].every(Number.isFinite) && duration > 0 && origin <= target + 0.1
    && origin + duration >= target + Math.max(0.1, Math.min(10, remaining));
}

/** The resolve may bucket to an integer, but the caller owns the exact target. */
export function restoreRequestedPosition(returned: unknown, requested: number): number {
  const value = typeof returned === 'number' && Number.isFinite(returned) && returned >= 0 ? returned : requested;
  return Math.abs(value - requested) < 1 ? requested : value;
}

/** A boundary should adopt its in-flight preparation, not abort and redo it. */
export const preparationMatches = (prepared: {at:number;token:string;audio:number|null}, at:number, token:string, audio:number|null): boolean =>
  Number.isFinite(at) && Math.abs(prepared.at - at) <= 4 && prepared.token === token && prepared.audio === audio;

/** Foreground playback must not inherit a background poller's entire budget. */
export async function waitForPreparation(work: Promise<unknown>, budgetMs = 1000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work.catch(() => undefined), new Promise<void>(resolve => {
      timer = setTimeout(resolve, budgetMs);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
