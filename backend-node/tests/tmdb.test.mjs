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
      cast: [{ id: 819, name: 'Edward Norton', character: 'The Narrator', profile_path: '/e.jpg' }],
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
  '/person/819': {
    id: 819, name: 'Edward Norton', biography: '', birthday: '1969-08-18', deathday: null,
    place_of_birth: 'Boston, USA', profile_path: '/n.jpg', known_for_department: 'Acting',
    combined_credits: {
      cast: [
        { id: 550, media_type: 'movie', title: 'Fight Club', character: 'The Narrator', poster_path: '/p.jpg', release_date: '1999-10-15', vote_average: 8.4, popularity: 90 },
        { id: 1399, media_type: 'tv', name: 'Game of Thrones', character: 'Khách mời', poster_path: null, first_air_date: '2011-04-17', vote_average: 8.4, popularity: 99 },
        { id: 100, media_type: 'movie', title: null, name: null, popularity: 1 },
        { id: 101, media_type: 'person', name: 'Ai Đó', popularity: 50 },
        { id: 102, media_type: 'tv', name: 'Talk Show', popularity: 999, genre_ids: [10767] },
      ],
    },
  },
};

let personEnglishCalls = 0;

let englishFallbackCalls = 0;

globalThis.fetch = async (url) => {
  const { pathname, searchParams } = new URL(url);
  const path = pathname.replace('/3', '');

  if (path === '/movie/550' && searchParams.get('language') === 'en-US') {
    englishFallbackCalls += 1;
    return { ok: true, status: 200, json: async () => ({ ...responses['/movie/550'], overview: 'English overview' }) };
  }

  if (path === '/person/819' && searchParams.get('language') === 'en-US') {
    personEnglishCalls += 1;
    return { ok: true, status: 200, json: async () => ({ ...responses['/person/819'], biography: 'English bio' }) };
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
assert.equal(detail.cast[0].id, 819, 'cast carries the TMDB person id for the actor page');
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

/* ---------------------------------------------------------------- person */
const person = await tmdb.getPerson(819);

assert.equal(person.id, 819);
assert.equal(person.name, 'Edward Norton');
assert.equal(person.biography, 'English bio', 'empty vi-VN bio falls back to en-US');
assert.equal(personEnglishCalls, 1, 'person fallback fires exactly once');
assert.equal(person.birthday, '1969-08-18');
assert.equal(person.placeOfBirth, 'Boston, USA');
assert.equal(person.profile, 'https://image.tmdb.org/t/p/h632/n.jpg');
assert.equal(person.filmography.length, 2, 'untitled and non movie/tv rows dropped');
assert.equal(person.filmography[0].tmdbId, 1399, 'sorted by popularity desc');
assert.equal(person.filmography[0].mediaType, 'tv');
assert.equal(person.filmography[0].poster, '', 'null poster_path yields empty string');
assert.equal(person.filmography[1].tmdbId, 550);
assert.equal(person.filmography[1].year, 1999);

assert.equal(await tmdb.getPerson(0), null, 'junk id returns null without fetching');
assert.equal(await tmdb.getPerson('abc'), null, 'non-numeric id returns null without fetching');

console.log('All TMDB normalizer assertions passed.');
process.exit(0);
