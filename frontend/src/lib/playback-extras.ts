export type SkipMark = { kind: 'intro' | 'recap' | 'credits'; start: number; end: number };
export const nextPlayableEpisode = <T extends { episodeNumber: number; airDate?: string | null }>(episodes: T[], current: number | null, today = new Date().toISOString().slice(0, 10)): T | undefined => {
  if (current == null || !episodes.some(ep => ep.episodeNumber === current)) return undefined;
  const next = episodes.filter(ep => Number.isInteger(ep.episodeNumber) && ep.episodeNumber > current)
    .sort((a, b) => a.episodeNumber - b.episodeNumber)[0];
  return next?.airDate && next.airDate > today ? undefined : next;
};
export const activeSkipMark = (marks: SkipMark[], at: number, duration: number, hasNext: boolean): SkipMark | undefined =>
  marks.find(mark => Number.isFinite(mark.start) && Number.isFinite(mark.end)
    && mark.start >= 0 && mark.end > mark.start && mark.end <= duration + 1
    && at >= mark.start && at < mark.end - 0.75
    && (mark.end < duration - 0.5 || hasNext));
export const seekPreviewPosition = (x: number, left: number, width: number, duration: number) => {
  if (![x, left, width, duration].every(Number.isFinite) || width <= 0 || duration <= 0) return null;
  const fraction = Math.max(0, Math.min(1, (x - left) / width));
  return { at: Math.min(Math.max(0, duration - 0.1), fraction * duration), percent: fraction * 100 };
};

export const fallbackPlaybackNotice = (code?: string | null): string => code === 'REMUX_NO_SPACE'
  ? 'Đang phát bản dự phòng vì máy chủ thiếu dung lượng để chuẩn bị bản chính. Bạn có thể chọn nguồn khác trong danh sách nguồn.'
  : 'Không mở được bản chính nên đang phát bản dự phòng. Bản này có thể khác thời lượng hoặc phụ đề; bạn có thể chọn nguồn khác trong danh sách nguồn.';
