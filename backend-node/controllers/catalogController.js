import { cached, CACHE_TTL } from '../config/redis.js';
import { isMediaType } from '../services/contentRef.js';
import * as tmdb from '../services/tmdb.js';
import { getPersonalizedRecommendations } from '../services/recommendations.js';

const fail = (res, status, message) => res.status(status).json({ success: false, message });

// Some Vietnamese ISPs DNS-poison themoviedb.org to 127.0.0.1, which surfaces as
// a connection refused to localhost:443 rather than anything TMDB-shaped.
const looksLikeDnsBlock = (error) => {
  const causeCode = error.cause?.code || error.cause?.errors?.[0]?.code;
  const address = error.cause?.errors?.[0]?.address || error.cause?.address;
  return (
    (causeCode === 'ECONNREFUSED' && ['127.0.0.1', '::1'].includes(address)) ||
    causeCode === 'ENOTFOUND'
  );
};

const handleError = (res, scope, error) => {
  console.error(`${scope} error:`, error.message);

  if (/chưa được cấu hình/.test(error.message)) {
    return fail(res, 503, 'Catalog chưa sẵn sàng: thiếu cấu hình TMDB');
  }

  if (looksLikeDnsBlock(error)) {
    console.error(
      `${scope}: api.themoviedb.org đang resolve về localhost. ` +
        'DNS của mạng này nhiều khả năng đang chặn themoviedb.org — ' +
        'đổi DNS (kể cả IPv6) sang 1.1.1.1 / 8.8.8.8 trên máy chạy backend.'
    );
    return fail(res, 502, 'Không kết nối được TMDB: DNS của server đang chặn themoviedb.org');
  }

  return fail(res, 502, 'Không lấy được dữ liệu từ TMDB');
};

const toPage = (value) => {
  const page = Number(value || 1);
  // TMDB rejects pages above 500.
  return Number.isInteger(page) && page >= 1 && page <= 500 ? page : 1;
};

export const getHome = async (req, res) => {
  try {
    const data = await cached('catalog:home', CACHE_TTL.HOME, () => tmdb.getHome());
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, 'getHome', error);
  }
};

export const searchCatalog = async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    const page = toPage(req.query.page);

    if (!query) {
      return res.json({
        success: true,
        data: { items: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0 } },
      });
    }

    const key = `catalog:search:${query.toLowerCase()}:${page}`;
    const data = await cached(key, CACHE_TTL.SEARCH, () => tmdb.search(query, page));
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, 'searchCatalog', error);
  }
};

export const discoverCatalog = async (req, res) => {
  try {
    const type = req.query.type === 'tv' ? 'tv' : 'movie';
    const genre = String(req.query.genre || '').trim();
    const region = String(req.query.region || '').trim();
    const year = String(req.query.year || '').trim();
    const page = toPage(req.query.page);

    const key = `catalog:discover:${type}:${genre}:${region}:${year}:${page}`;
    const data = await cached(key, CACHE_TTL.DISCOVER, () =>
      tmdb.discover({ type, genre, region, year, page })
    );
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, 'discoverCatalog', error);
  }
};

export const getGenres = async (req, res) => {
  try {
    const type = req.params.type === 'tv' ? 'tv' : 'movie';
    const map = await tmdb.getGenreMap(type);
    const genres = Object.entries(map).map(([id, name]) => ({ id: Number(id), name }));
    return res.json({ success: true, data: { genres } });
  } catch (error) {
    return handleError(res, 'getGenres', error);
  }
};

export const getDetail = async (req, res) => {
  try {
    const { type } = req.params;
    const tmdbId = Number(req.params.tmdbId);

    if (!isMediaType(type)) return fail(res, 400, 'type phải là movie hoặc tv');
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) return fail(res, 400, 'tmdbId không hợp lệ');

    // :vN is the shape of the normalized detail: bump it with every field
    // added to it, or entries cached before the deploy keep serving the old
    // shape for a day and the new field reads as undefined (see the same key
    // in playbackController, where that cost a show its own audio language).
    const data = await cached(`catalog:detail:${type}:${tmdbId}:v3`, CACHE_TTL.DETAIL, () =>
      tmdb.getDetail(type, tmdbId)
    );

    if (!data) return fail(res, 404, 'Không tìm thấy nội dung');
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, 'getDetail', error);
  }
};

export const getPerson = async (req, res) => {
  try {
    const personId = Number(req.params.personId);

    if (!Number.isInteger(personId) || personId <= 0) return fail(res, 400, 'personId không hợp lệ');

    const data = await cached(`catalog:person:${personId}:v2`, CACHE_TTL.DETAIL, () =>
      tmdb.getPerson(personId)
    );

    if (!data) return fail(res, 404, 'Không tìm thấy diễn viên');
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, 'getPerson', error);
  }
};

export const getSeason = async (req, res) => {
  try {
    const tmdbId = Number(req.params.tmdbId);
    const season = Number(req.params.season);

    if (!Number.isInteger(tmdbId) || tmdbId <= 0) return fail(res, 400, 'tmdbId không hợp lệ');
    if (!Number.isInteger(season) || season < 0) return fail(res, 400, 'season không hợp lệ');

    const data = await cached(`catalog:season:${tmdbId}:${season}`, CACHE_TTL.SEASON, () =>
      tmdb.getSeason(tmdbId, season)
    );

    if (!data) return fail(res, 404, 'Không tìm thấy mùa phim');
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, 'getSeason', error);
  }
};

export const getRecommendations = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { type, tmdbId } = req.query;

    // Nếu có type và tmdbId truyền vào, lấy gợi ý dựa trên phim đó
    // Nếu không, lấy gợi ý dựa trên lịch sử xem của user
    const data = await getPersonalizedRecommendations(userId, type, tmdbId);
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, 'getRecommendations', error);
  }
};
