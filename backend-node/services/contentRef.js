// Internal content identity for the TMDB-backed catalog.
//   movie    -> tmdb:movie:{id}
//   tv show  -> tmdb:tv:{id}
//   episode  -> tmdb:tv:{id}:s{season}:e{episode}

export const MEDIA_TYPES = ['movie', 'tv'];

export const isMediaType = (value) => MEDIA_TYPES.includes(value);

export const buildContentRef = ({ mediaType, tmdbId, seasonNumber, episodeNumber }) => {
  if (!isMediaType(mediaType)) {
    throw new Error(`mediaType không hợp lệ: ${mediaType}`);
  }

  const id = Number(tmdbId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`tmdbId không hợp lệ: ${tmdbId}`);
  }

  const base = `tmdb:${mediaType}:${id}`;
  if (mediaType !== 'tv') return base;

  const season = Number(seasonNumber);
  const episode = Number(episodeNumber);
  const hasSeason = Number.isInteger(season) && season >= 0;
  const hasEpisode = Number.isInteger(episode) && episode > 0;

  if (!hasSeason || !hasEpisode) return base;
  return `${base}:s${season}:e${episode}`;
};

const REF_PATTERN = /^tmdb:(movie|tv):(\d+)(?::s(\d+):e(\d+))?$/;

export const parseContentRef = (contentRef) => {
  const match = REF_PATTERN.exec(String(contentRef || ''));
  if (!match) return null;

  const [, mediaType, tmdbId, season, episode] = match;

  return {
    contentRef: String(contentRef),
    mediaType,
    tmdbId: Number(tmdbId),
    seasonNumber: season === undefined ? null : Number(season),
    episodeNumber: episode === undefined ? null : Number(episode),
  };
};

export const isContentRef = (value) => REF_PATTERN.test(String(value || ''));

// Slug is SEO-only; it never identifies content.
export const toSlug = (title = '') =>
  String(title)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'phim';
