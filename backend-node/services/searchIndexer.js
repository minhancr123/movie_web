import { bulkUpsertMovies, upsertMovieIndex } from '../config/elasticsearch.js';

export const indexMovie = async (movie) => {
  if (!movie?.slug) return;
  await upsertMovieIndex(movie);
};

export const indexMoviesBulk = async (movies) => {
  if (!Array.isArray(movies) || !movies.length) return;
  await bulkUpsertMovies(movies.filter((m) => m?.slug));
};
