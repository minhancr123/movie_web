import { getDB } from '../config/database.js';
import { getDecryptedKey } from '../services/providers/connectionStore.js';
import * as torbox from '../services/debrid/torbox.js';
import { getTimelineMarks } from '../services/playback/timelineMarks.js';
import { getRemuxSession, respawnSessionWriter } from '../services/playback/remuxService.js';
import { SeekThumbnailCache } from '../services/playback/seekThumbnails.js';
const thumbnails = new SeekThumbnailCache();

export const findOwnedPlaybackSession = async (db, sessionId, userId) => {
  if (typeof sessionId !== 'string' || !/^[a-f0-9]{32}$/.test(sessionId)) return null;
  return db.collection('playback_sessions').findOne({
    sessionId, userIdStr: String(userId), expiresAt: { $gt: new Date() },
  });
};
const durationOf = session => Number(session.durationSeconds);

// Writer-death respawn qua timeline poll: poll 2s của người xem ĐANG XEM là
// tín hiệu còn người xem đáng tin nhất. Guard 1 lần/15s mỗi session để poll
// nhanh không kích hoạt liên tục; respawn tự giới hạn 2 lần mỗi session và
// chỉ chạy khi playlist CHƯA ENDLIST (phim hết rồi thì để yên).
const respawnGate = new Map();
const RESPAWN_GATE_MS = 15_000;

export const getPlaybackTimeline = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const session = await findOwnedPlaybackSession(getDB(), req.params.sessionId, req.user.userId);
    if (!session) return res.status(404).json({ success: false });

    // Fire-and-forget: không block marks. Chỉ remux + writer chết + chưa endlist.
    if (session.mode === 'remux' && session.torrentId != null) {
      const live = getRemuxSession(session.sessionId);
      const now = Date.now();
      const last = respawnGate.get(session.sessionId) || 0;
      if (live && live.exitCode !== undefined && now - last > RESPAWN_GATE_MS) {
        respawnGate.set(session.sessionId, now);
        void (async () => {
          try {
            const { key } = await getDecryptedKey(getDB(), req.user.userId, session.provider || 'torbox');
            const freshUrl = await torbox.getDownloadUrl(key, {
              torrentId: session.torrentId,
              fileId: session.fileId,
              userId: req.user.userId,
            });
            const result = await respawnSessionWriter({ sessionId: session.sessionId, inputUrl: freshUrl });
            if (!result.respawned) console.log(`[remux-respawn] bỏ qua: ${result.reason}`);
          } catch (error) {
            console.warn(`[remux-respawn] ${session.sessionId.slice(0, 8)} thất bại: ${error.message}`);
          }
        })();
      }
    }

    const marks = await getTimelineMarks({ type: session.mediaType, tmdbId: session.tmdbId,
      season: session.season, episode: session.episode, duration: durationOf(session) });
    return res.json({ success: true, data: { marks } });
  } catch { return res.json({ success: true, data: { marks: [] } }); }
};

export const getPlaybackThumbnail = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const db = getDB();
    const session = await findOwnedPlaybackSession(db, req.params.sessionId, req.user.userId);
    if (!session) return res.status(404).end();
    // Only the owned provider file is a source. Never accept a URL from a client.
    if (session.provider !== 'torbox' || session.fileId == null || !session.infoHash) return res.status(204).end();
    const at = typeof req.query.at === 'string' && req.query.at.trim() ? Number(req.query.at) : NaN;
    const frame = await thumbnails.get({ infoHash: session.infoHash, fileId: session.fileId,
      at, duration: durationOf(session), getUrl: async () => {
        const { key } = await getDecryptedKey(db, req.user.userId, 'torbox');
        return torbox.getDownloadUrl(key, { torrentId: session.torrentId, fileId: session.fileId, userId: String(req.user.userId) });
      } });
    if (!frame) return res.status(204).end();
    return res.type('image/jpeg').send(frame);
  } catch { return res.status(204).end(); }
};
