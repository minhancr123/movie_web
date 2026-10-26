import crypto from 'node:crypto';
export const credentialScope = key => crypto.createHash('sha256').update(String(key || '')).digest('hex');
export async function requestedCandidates({ imdbId, mediaType, season, episode, debridKey }) {
  if (!imdbId || !debridKey) return [];
  try {
    const { getDB } = await import('../../config/database.js');
    const rows = await getDB().collection('requested_sources').find({ credentialScope: credentialScope(debridKey), imdbId, mediaType,
      season: season ?? null, episode: episode ?? null }).sort({ verifiedAt: -1 }).limit(10).toArray();
    return rows.map(r => r.candidate);
  } catch { return []; }
}
