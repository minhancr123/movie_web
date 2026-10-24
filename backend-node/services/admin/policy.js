export const DEFAULT_CATALOG_LIMIT = 120;
let snapshot = { value: DEFAULT_CATALOG_LIMIT, until: 0 };
export const validCatalogLimit = value => typeof value === 'number' && Number.isInteger(value) && value >= 30 && value <= 3000;
export const getCatalogLimit = async () => {
  if (snapshot.until > Date.now()) return snapshot.value;
  try {
    const { getDB } = await import('../../config/database.js');
    const row = await getDB().collection('site_settings').findOne({ _id: 'catalogRateLimit' });
    snapshot = { value: validCatalogLimit(row?.value) ? row.value : DEFAULT_CATALOG_LIMIT, until: Date.now() + 10000 };
  } catch { snapshot.until = Date.now() + 3000; }
  return snapshot.value;
};
export const setCatalogLimit = async (value, userId) => {
  if (!validCatalogLimit(value)) throw new Error('Giới hạn phải là số nguyên từ 30 đến 3000.');
  const { getDB } = await import('../../config/database.js');
  await getDB().collection('site_settings').updateOne({ _id: 'catalogRateLimit' },
    { $set: { value, updatedAt: new Date(), updatedBy: String(userId) } }, { upsert: true });
  snapshot = { value, until: Date.now() + 10000 };
};
export const parseAdminList = query => ({
  page: Math.min(10000, Math.max(1, Number.parseInt(query.page, 10) || 1)),
  limit: Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20)),
  search: typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '',
  role: ['admin', 'user'].includes(query.role) ? query.role : undefined,
});
export const literalSearch = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// All admin lists use allowlists: never return credential fields or media URLs.
export const USER_FIELDS = { username: 1, email: 1, role: 1, createdAt: 1, updatedAt: 1 };
export const SESSION_FIELDS = { sessionId: 1, tmdbId: 1, type: 1, season: 1, episode: 1, mode: 1, provider: 1, progress: 1, createdAt: 1, updatedAt: 1, expiresAt: 1, startAt: 1 };
