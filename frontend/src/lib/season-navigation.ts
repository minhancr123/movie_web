export const nextSeasonNumber = (seasons: { seasonNumber: number }[], current: number | null): number | null =>
  current === null ? null : seasons.filter(item => item.seasonNumber > current)
    .sort((a, b) => a.seasonNumber - b.seasonNumber)[0]?.seasonNumber ?? null;

export const firstAvailableEpisode = <T extends { episodeNumber: number; airDate?: string | null }>(episodes: T[], today = new Date().toISOString().slice(0, 10)): T | undefined => {
  const first = episodes.filter(item => item.episodeNumber > 0).sort((a, b) => a.episodeNumber - b.episodeNumber)[0];
  // Do not skip an unreleased first episode and silently start later in a season.
  return first?.airDate && first.airDate > today ? undefined : first;
};

export const isLastEpisode = (episodes: { episodeNumber: number }[], current: number | null): boolean =>
  current !== null && episodes.some(item => item.episodeNumber === current)
    && !episodes.some(item => item.episodeNumber > current);

/** Browsing a season must never carry an episode or an autoplay restart flag. */
export const seasonBrowseHref = (href: string): string => {
  const target = new URL(href, 'https://cinevn.me');
  target.searchParams.delete('e');
  target.searchParams.delete('restart');
  return target.pathname + target.search + '#episodes';
};
