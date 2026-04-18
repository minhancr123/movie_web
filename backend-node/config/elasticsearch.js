import { Client } from '@elastic/elasticsearch';

const elasticNode = process.env.ELASTICSEARCH_URL || 'http://127.0.0.1:9200';
export const MOVIE_INDEX = process.env.ELASTICSEARCH_MOVIE_INDEX || 'movieweb_movies';

export const esClient = new Client({ node: elasticNode });

export const isElasticEnabled = () => process.env.ELASTICSEARCH_ENABLED !== 'false';

export const ensureMovieIndex = async () => {
  if (!isElasticEnabled()) return;

  const exists = await esClient.indices.exists({ index: MOVIE_INDEX });
  if (exists) return;

  await esClient.indices.create({
    index: MOVIE_INDEX,
    mappings: {
      properties: {
        slug: { type: 'keyword' },
        name: { type: 'text' },
        origin_name: { type: 'text' },
        year: { type: 'integer' },
        quality: { type: 'keyword' },
        lang: { type: 'keyword' },
        poster_url: { type: 'keyword' },
        thumb_url: { type: 'keyword' },
        category_slugs: { type: 'keyword' },
        category_names: { type: 'text' },
        country_slugs: { type: 'keyword' },
        country_names: { type: 'text' },
        updated_at: { type: 'date' },
      },
    },
  });
};

export const upsertMovieIndex = async (movie) => {
  if (!isElasticEnabled()) return;

  await esClient.index({
    index: MOVIE_INDEX,
    id: movie.slug,
    document: movie,
    refresh: false,
  });
};

export const bulkUpsertMovies = async (movies) => {
  if (!isElasticEnabled() || !movies.length) return;

  const operations = [];
  for (const movie of movies) {
    operations.push({ index: { _index: MOVIE_INDEX, _id: movie.slug } });
    operations.push(movie);
  }

  await esClient.bulk({ refresh: false, operations });
};

export const searchMovieIndex = async ({ keyword, genre, country, year, page = 1, limit = 20 }) => {
  if (!isElasticEnabled()) {
    return { items: [], total: 0 };
  }

  const must = [];
  const filter = [];

  if (keyword) {
    must.push({
      multi_match: {
        query: keyword,
        fields: ['name^3', 'origin_name^2', 'category_names', 'country_names'],
        fuzziness: 'AUTO',
      },
    });
  }

  if (genre) filter.push({ term: { category_slugs: genre } });
  if (country) filter.push({ term: { country_slugs: country } });
  if (year) filter.push({ term: { year: Number(year) } });

  const query = must.length || filter.length
    ? { bool: { must, filter } }
    : { match_all: {} };

  const from = Math.max(0, (page - 1) * limit);
  const result = await esClient.search({
    index: MOVIE_INDEX,
    from,
    size: limit,
    query,
    sort: [{ updated_at: 'desc' }],
  });

  const hits = result.hits?.hits || [];
  return {
    items: hits.map((hit) => hit._source),
    total: Number(result.hits?.total?.value || 0),
  };
};
