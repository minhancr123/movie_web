import { ObjectId } from 'mongodb';
import { getDB } from '../config/database.js';
import { enqueueJob, JOBS } from '../config/queue.js';

export const trackViewAsync = async (req, res) => {
  try {
    const { movieSlug, currentTime = 0 } = req.body;
    if (!movieSlug) {
      return res.status(400).json({ success: false, message: 'movieSlug is required' });
    }

    await enqueueJob(JOBS.VIEW_INCREMENT, {
      movieSlug,
      currentTime,
      userId: req.user?.userId || null,
      source: req.body.source || 'web',
      userAgent: req.headers['user-agent'] || '',
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
      occurredAt: new Date().toISOString(),
    });

    return res.status(202).json({ success: true, message: 'View event queued' });
  } catch (error) {
    console.error('trackViewAsync error:', error);
    return res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};

export const getViewCount = async (req, res) => {
  try {
    const db = getDB();
    const movieSlug = req.params.movieSlug;

    const stat = await db.collection('movie_stats').findOne({ movieSlug });
    return res.json({ success: true, views: stat?.views || 0 });
  } catch (error) {
    console.error('getViewCount error:', error);
    return res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};

export const trackEventAsync = async (req, res) => {
  try {
    const { type, payload = {} } = req.body;
    if (!type) {
      return res.status(400).json({ success: false, message: 'type is required' });
    }

    await enqueueJob(JOBS.ANALYTICS_TRACK, {
      type,
      payload,
      userId: req.user?.userId || null,
      userAgent: req.headers['user-agent'] || '',
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
      occurredAt: new Date().toISOString(),
    });

    return res.status(202).json({ success: true, message: 'Analytics event queued' });
  } catch (error) {
    console.error('trackEventAsync error:', error);
    return res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};
