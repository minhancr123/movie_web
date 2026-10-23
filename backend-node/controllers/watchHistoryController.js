import { getDB } from '../config/database.js';
import { ObjectId } from 'mongodb';
import { parseContentRef } from '../services/contentRef.js';
import { enqueueJob, JOBS } from '../config/queue.js';

// Clients send contentRef explicitly, and movieSlug now carries the same value,
// so parse whichever is present. Rows written before the TMDB cutover simply
// resolve to nulls and keep working off movieSlug alone.
const tmdbIdentity = (body = {}) => {
  const parsed = parseContentRef(body.contentRef || body.movieSlug || '');
  return {
    contentRef: parsed?.contentRef ?? null,
    tmdbId: body.tmdbId ?? parsed?.tmdbId ?? null,
    mediaType: body.mediaType ?? parsed?.mediaType ?? null,
    seasonNumber: body.seasonNumber ?? parsed?.seasonNumber ?? null,
    episodeNumber: body.episodeNumber ?? parsed?.episodeNumber ?? null,
  };
};

// Add or update watch history
export const addWatchHistory = async (req, res) => {
  try {
    const { movieSlug, movieData, episode, server, currentTime } = req.body;
    const userId = req.user.userId;
    const db = getDB();

    const safeCurrentTime = currentTime || 0;
    // Per-episode progress map: the flat pair only covers continue-watching;
    // resuming a DIFFERENT episode needs the position of that episode. Keys
    // are the client's s{season}e{n} slugs; dots are stripped because Mongo
    // treats them as paths.
    const episodeKey = String(episode || '').replace(/\./g, '_');
    const episodeProgressSet = episodeKey
      ? { [`episodeProgress.${episodeKey}`]: { progress: safeCurrentTime, duration: Number(req.body.duration) || null, watchedAt: new Date() } }
      : {};
    // Single upsert instead of findOne + insert/updateOne: one round-trip on a
    // path the player calls continuously while watching, and no duplicate-row
    // race between two concurrent progress saves.
    const existedBefore = await db.collection('watch_history').updateOne(
      { userId: new ObjectId(userId), movieSlug },
      {
        $set: {
          ...tmdbIdentity(req.body),
          episode,
          server,
          currentTime: safeCurrentTime,
          ...episodeProgressSet,
          watchedAt: new Date()
        },
        $setOnInsert: {
          movieData: {
            name: movieData.name,
            originName: movieData.originName,
            posterUrl: movieData.posterUrl,
            thumbUrl: movieData.thumbUrl,
            year: movieData.year
          }
        }
      },
      { upsert: true }
    );

    res.json({
      success: true,
      message: 'Đã lưu lịch sử xem'
    });

    enqueueJob(JOBS.WATCH_HISTORY_SYNC, {
      action: existedBefore?.upsertedId ? 'insert' : 'update',
      userId,
      movieSlug,
      episode,
      server,
      currentTime: currentTime || 0,
      occurredAt: new Date().toISOString(),
    }).catch((err) => console.error('watch history sync enqueue error:', err.message));
  } catch (error) {
    console.error('Add watch history error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Get user's watch history
export const getWatchHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const db = getDB();

    const history = await db.collection('watch_history')
      .find({ userId: new ObjectId(userId) })
      .sort({ watchedAt: -1 })
      .limit(limit)
      .toArray();

    res.json({
      success: true,
      history
    });
  } catch (error) {
    console.error('Get watch history error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Delete watch history item
export const deleteWatchHistory = async (req, res) => {
  try {
    const { movieSlug } = req.params;
    const userId = req.user.userId;
    const db = getDB();

    await db.collection('watch_history').deleteOne({ 
      userId: new ObjectId(userId), 
      movieSlug 
    });

    enqueueJob(JOBS.WATCH_HISTORY_SYNC, {
      action: 'delete',
      userId,
      movieSlug,
      occurredAt: new Date().toISOString(),
    }).catch((err) => console.error('watch history sync enqueue error:', err.message));

    res.json({
      success: true,
      message: 'Đã xóa khỏi lịch sử'
    });
  } catch (error) {
    console.error('Delete watch history error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Clear all watch history
export const clearWatchHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const db = getDB();

    await db.collection('watch_history').deleteMany({ 
      userId: new ObjectId(userId)
    });

    enqueueJob(JOBS.WATCH_HISTORY_SYNC, {
      action: 'clear',
      userId,
      occurredAt: new Date().toISOString(),
    }).catch((err) => console.error('watch history sync enqueue error:', err.message));

    res.json({
      success: true,
      message: 'Đã xóa toàn bộ lịch sử'
    });
  } catch (error) {
    console.error('Clear watch history error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};
