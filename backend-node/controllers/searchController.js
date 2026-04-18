import { searchMovieIndex } from '../config/elasticsearch.js';

const sourceApi = process.env.MOVIE_SOURCE_API_URL || 'https://phimapi.com';

export const searchCatalog = async (req, res) => {
  try {
    const keyword = String(req.query.keyword || '').trim();
    const genre = String(req.query.genre || '').trim();
    const country = String(req.query.country || '').trim();
    const year = req.query.year;
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);

    const esResult = await searchMovieIndex({ keyword, genre, country, year, page, limit });
    if (esResult.items.length > 0) {
      return res.json({
        success: true,
        source: 'elasticsearch',
        items: esResult.items,
        pagination: {
          totalItems: esResult.total,
          totalItemsPerPage: limit,
          currentPage: page,
          totalPages: Math.max(1, Math.ceil(esResult.total / limit)),
        },
      });
    }

    if (!keyword) {
      return res.json({ success: true, source: 'elasticsearch', items: [], pagination: { totalItems: 0, totalItemsPerPage: limit, currentPage: page, totalPages: 0 } });
    }

    // Fallback to source API search when index has not been warmed up.
    const fallback = await fetch(`${sourceApi}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}&page=${page}&limit=${limit}`);
    if (!fallback.ok) {
      return res.json({ success: true, source: 'fallback-empty', items: [], pagination: { totalItems: 0, totalItemsPerPage: limit, currentPage: page, totalPages: 0 } });
    }

    const payload = await fallback.json();
    const items = payload?.data?.items || [];
    const pagination = payload?.data?.params?.pagination || { totalItems: items.length, totalItemsPerPage: limit, currentPage: page, totalPages: 1 };

    return res.json({ success: true, source: 'phimapi-fallback', items, pagination });
  } catch (error) {
    console.error('searchCatalog error:', error);
    return res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};
