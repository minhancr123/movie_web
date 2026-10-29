import { cached, CACHE_TTL } from '../config/redis.js';
import * as tmdb from '../services/tmdb.js';
import { lookupVietnameseCatalogues, isAllowedEmbeddedPlayer } from '../services/playback/vietnameseCatalogues.js';

export const embeddedPickerEntry = s => ({
  sourceToken: s.sourceToken, filename: s.title, releaseSource: 'Nguồn C · Vietsub nhúng',
  origin: 'nguonc', playbackType: 'embedded', directPlay: 'unknown', playable: true,
  cached: false, recommended: false, resolution: null,
  reasons: ['Dùng trình phát web của nhà cung cấp; tính năng phụ thuộc nguồn'],
});

export const getEmbeddedSources = args => cached(
  `playback:embedded:v1:${args.type}:${args.tmdbId}:${args.season ?? ''}:${args.episode ?? ''}`,
  60, () => lookupVietnameseCatalogues({ ...args, detail: { ...args.detail, tmdbId: args.tmdbId } }, { mode: 'embedded' }),
);

/** Explicit opt-in route: legacy clients still receive native media only.
 * No TorBox credential, account cookie or media grant reaches the provider. */
export const createEmbeddedPlaybackHandler = ({
  loadDetail = (type, tmdbId) => cached(`catalog:detail:${type}:${tmdbId}:v3`, CACHE_TTL.DETAIL,
    () => tmdb.getDetail(type, tmdbId), tmdb.STALE_OPTS),
  loadSources = getEmbeddedSources,
} = {}) => async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const { type, tmdbId, season = null, episode = null, embedToken } = req.body || {};
  if (!['movie', 'tv'].includes(type) || !Number.isSafeInteger(tmdbId) || tmdbId <= 0
    || (type === 'movie' && (season != null || episode != null))
    || (type === 'tv' && (!Number.isSafeInteger(season) || season < 1 || !Number.isSafeInteger(episode) || episode < 1))
    || (embedToken != null && !/^embedded:nguonc:[a-f0-9]{24}$/.test(embedToken)))
    return res.status(400).json({ success: false, message: 'Thông tin phim/tập không hợp lệ' });
  try {
    const detail = await loadDetail(type, tmdbId);
    if (!detail) return res.status(404).json({ success: false, code: 'CONTENT_NOT_FOUND', message: 'Không tìm thấy phim' });
    const sources = await loadSources({ type, tmdbId, season, episode, detail });
    const source = embedToken ? sources.find(s => s.sourceToken === embedToken) : sources[0];
    if (!source) return res.status(404).json({ success: false, code: 'NO_EMBEDDED_SOURCE', message: 'Chưa có nguồn phát nhúng cho phim/tập này' });
    if (!isAllowedEmbeddedPlayer(source.url)) throw new Error('Unsupported embedded player');
    return res.json({ success: true, data: { url: source.url, sourceToken: source.sourceToken,
      title: detail.title, provider: 'Nguồn C', mode: 'embedded' } });
  } catch {
    return res.status(503).json({ success: false, code: 'EMBEDDED_PROVIDER_UNAVAILABLE', message: 'Dịch vụ nguồn nhúng chưa phản hồi. Vui lòng thử lại sau.' });
  }
};
export const getEmbeddedPlayback = createEmbeddedPlaybackHandler();
