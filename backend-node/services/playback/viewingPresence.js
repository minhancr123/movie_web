export const VIEWING_FRESH_MS = 75_000;
const states = new Set(['playing', 'paused', 'buffering', 'ended']);

// A session lease also covers preparation and paused tabs. Only explicit
// player state counts as viewing; never infer it from session expiry.
export async function recordViewingPresence(db, session, userId, viewerId, report, now = new Date()) {
  if (!report || !states.has(report.state) || typeof report.position !== 'number'
      || !Number.isFinite(report.position) || report.position < 0) return;
  if (session.expiresAt && new Date(session.expiresAt) <= now) return;
  await db.collection('playback_presence').updateOne(
    { userIdStr: String(userId), sessionId: session.sessionId, viewerId },
    { $set: { state: report.state, position: Math.min(report.position, 604800),
      tmdbId: session.tmdbId, type: session.type || session.mediaType || 'movie',
      season: session.season ?? null, episode: session.episode ?? null,
      seenAt: now, expiresAt: new Date(now.getTime() + VIEWING_FRESH_MS) } },
    { upsert: true },
  );
}

export const activeViewingQuery = (userIds, now = new Date()) => ({
  userIdStr: { $in: userIds.map(String) }, state: 'playing',
  seenAt: { $gt: new Date(now.getTime() - VIEWING_FRESH_MS) }, expiresAt: { $gt: now },
});

export const VIEWING_FIELDS = { _id: 0, userIdStr: 1, sessionId: 1, tmdbId: 1,
  type: 1, season: 1, episode: 1, position: 1, seenAt: 1 };
