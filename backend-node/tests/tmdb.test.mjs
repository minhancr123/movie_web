// Offline check of the TMDB normalizers: stubs fetch with representative TMDB
// payloads and asserts the DTO shape the frontend will consume.
process.env.TMDB_API_KEY = 'test-key';
process.env.REDIS_URL = 'redis://127.0.0.1:6399'; // nothing listening -> cache always misses

import assert from 'node:assert/strict';

const responses = {
  '/genre/movie/list': { genres: [{ id: 28, name: 'Hành động' }, { id: 878, name: 'Khoa học viễn tưởng' }] },
  '/genre/tv/list': { genres: [{ id: 18, name: 'Chính kịch' }] },
  '/search/multi': {
    page: 1,
    total_pages: 3,
    total_results: 42,
    results: [
      {
        id: 550, media_type: 'movie', title: 'Sàn Đấu Sinh Tử', original_title: 'Fight Club',
        release_date: '1999-10-15', overview: 'Mô tả tiếng Việt', poster_path: '/p.jpg',
        backdrop_path: '/b.jpg', genre_ids: [28, 878], vote_average: 8.4,
      },
      {
        id: 1399, media_type: 'tv', name: 'Trò Chơi Vương Quyền', original_name: 'Game of Thrones',
        first_air_date: '2011-04-17', overview: '', poster_path: '/g.jpg',
        backdrop_path: null, genre_ids: [18], vote_average: 8.4,
      },
      { id: 99, media_type: 'person', name: 'Ai Đó' }, // must be dropped
    ],
  },
  '/movie/550': {
    id: 550, title: 'Sàn Đấu Sinh Tử', original_title: 'Fight Club', release_date: '1999-10-15',
    overview: '', runtime: 139, status: 'Released', vote_average: 8.4,
    poster_path: '/p.jpg', backdrop_path: '/b.jpg', genres: [{ id: 18, name: 'Chính kịch' }],
    external_ids: { imdb_id: 'tt0137523' },
    credits: {
      cast: [{ name: 'Edward Norton', character: 'The Narrator', profile_path: '/e.jpg' }],
      crew: [{ name: 'David Fincher', job: 'Director' }, { name: 'Ai Đó', job: 'Editor' }],
    },
    videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'abc123' }] },
  },
  '/tv/1399/season/2': {
    season_number: 2, name: 'Mùa 2', overview: '', poster_path: '/s.jpg',
    episodes: [
      { episode_number: 1, name: 'Tập 1', overview: '', air_date: '2012-04-01', runtime: 53, still_path: '/st.jpg' },
      { episode_number: 2, name: 'Tập 2', overview: '', air_date: '2012-04-08', runtime: 54, still_path: null },
    ],
  },
};

let englishFallbackCalls = 0;

globalThis.fetch = async (url) => {
  const { pathname, searchParams } = new URL(url);
  const path = pathname.replace('/3', '');

  if (path === '/movie/550' && searchParams.get('language') === 'en-US') {
    englishFallbackCalls += 1;
    return { ok: true, status: 200, json: async () => ({ ...responses['/movie/550'], overview: 'English overview' }) };
  }

  const body = responses[path];
  if (!body) return { ok: false, status: 404 };
  return { ok: true, status: 200, json: async () => body };
};

const tmdb = await import('../services/tmdb.js');

/* ---------------------------------------------------------------- search */
const searchResult = await tmdb.search('fight club', 1);

assert.equal(searchResult.items.length, 2, 'person entry must be filtered out');
assert.deepEqual(searchResult.pagination, { currentPage: 1, totalPages: 3, totalItems: 42 });

const [movie, tv] = searchResult.items;
assert.equal(movie.contentRef, 'tmdb:movie:550');
assert.equal(movie.mediaType, 'movie');
assert.equal(movie.title, 'Sàn Đấu Sinh Tử');
assert.equal(movie.originalTitle, 'Fight Club');
assert.equal(movie.slug, 'san-dau-sinh-tu');
assert.equal(movie.year, 1999);
assert.equal(movie.poster, 'https://image.tmdb.org/t/p/w500/p.jpg');
assert.deepEqual(movie.genres, ['Hành động', 'Khoa học viễn tưởng'], 'movie genre map applied');

assert.equal(tv.contentRef, 'tmdb:tv:1399');
assert.equal(tv.mediaType, 'tv');
assert.equal(tv.title, 'Trò Chơi Vương Quyền');
assert.deepEqual(tv.genres, ['Chính kịch'], 'tv genre map applied, not the movie one');
assert.equal(tv.backdrop, '', 'null backdrop_path yields empty string, not a broken URL');

/* ---------------------------------------------------------------- detail */
const detail = await tmdb.getDetail('movie', 550);

assert.equal(detail.contentRef, 'tmdb:movie:550');
assert.equal(detail.imdbId, 'tt0137523', 'imdbId must be lifted from external_ids');
assert.equal(detail.overview, 'English overview', 'empty vi-VN overview falls back to en-US');
assert.equal(englishFallbackCalls, 1, 'fallback fires exactly once');
assert.deepEqual(detail.directors, ['David Fincher']);
assert.equal(detail.cast.length, 1);
assert.equal(detail.trailerKey, 'abc123');
assert.equal(detail.runtime, 139);
assert.equal(detail.seasons, undefined, 'movies carry no seasons');

/* ---------------------------------------------------------------- season */
const season = await tmdb.getSeason(1399, 2);

assert.equal(season.episodes.length, 2);
assert.equal(season.episodes[0].contentRef, 'tmdb:tv:1399:s2:e1');
assert.equal(season.episodes[1].contentRef, 'tmdb:tv:1399:s2:e2');
assert.equal(season.episodes[1].still, '', 'null still_path yields empty string');

/* ------------------------------------------------------------- not found */
const missing = await tmdb.getDetail('movie', 424242);
assert.equal(missing, null, '404 from TMDB surfaces as null, not a throw');

console.log('All TMDB normalizer assertions passed.');
process.exit(0);
