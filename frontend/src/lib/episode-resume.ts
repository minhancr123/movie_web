type Progress = { progress?: number; duration?: number };
type EpisodeHistory = Progress & { currentEpisode?: string; episodeProgress?: Record<string, Progress> };

/** The player writes history through its own hook instance. Read the latest
 * persisted value at interaction time instead of the parent's mount snapshot. */
export function readEpisodeHistory(slug: string, fallback?: EpisodeHistory,
  read = () => typeof window === 'undefined' ? null : window.localStorage.getItem('watch_history')): EpisodeHistory | undefined {
  try {
    const rows = JSON.parse(read() || 'null');
    return Array.isArray(rows) ? rows.find(row => row?.slug === slug) : fallback;
  } catch { return fallback; }
}

/** Never reuse the flat playhead of a different episode/season. Completed
 * episodes start fresh; an unfinished episode gets an explicit choice. */
export function episodeResumePosition(saved: EpisodeHistory | undefined, slug: string, fallbackDuration = 0): number | null {
  const entry = saved?.episodeProgress?.[slug] ?? (saved?.currentEpisode === slug ? saved : undefined);
  const at = entry?.progress;
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 1) return null;
  const recordedDuration = Number(entry?.duration);
  const duration = Number.isFinite(recordedDuration) && recordedDuration > 0 ? recordedDuration : fallbackDuration;
  if (Number.isFinite(duration) && duration > 0 && at >= duration - Math.min(30, duration * 0.05)) return null;
  return Math.floor(at);
}

export const episodeResumeLabel = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
