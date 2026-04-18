const sourceApi = process.env.MOVIE_SOURCE_API_URL || 'https://phimapi.com';
const imagePrefix = process.env.NEXT_PUBLIC_IMAGE_PREFIX || 'https://phimimg.com/';

const withAbsoluteImage = (url = '') => {
  if (!url) return '';
  return url.startsWith('http') ? url : `${imagePrefix}${url}`;
};

const normalizeMovie = (movie) => ({
  slug: movie.slug,
  name: movie.name,
  origin_name: movie.origin_name,
  year: Number(movie.year || 0),
  quality: movie.quality || '',
  lang: movie.lang || '',
  poster_url: withAbsoluteImage(movie.poster_url),
  thumb_url: withAbsoluteImage(movie.thumb_url),
  category_slugs: (movie.category || []).map((c) => c.slug),
  category_names: (movie.category || []).map((c) => c.name),
  country_slugs: (movie.country || []).map((c) => c.slug),
  country_names: (movie.country || []).map((c) => c.name),
  updated_at: movie.modified?.time || new Date().toISOString(),
});

export const fetchLatestCatalog = async (maxPages = 2) => {
  const pages = Math.max(1, Number(maxPages) || 1);
  const all = [];

  for (let page = 1; page <= pages; page += 1) {
    const res = await fetch(`${sourceApi}/danh-sach/phim-moi-cap-nhat?page=${page}`);
    if (!res.ok) continue;

    const payload = await res.json();
    const items = payload.items || payload.data?.items || [];
    all.push(...items.map(normalizeMovie));
  }

  return all;
};
