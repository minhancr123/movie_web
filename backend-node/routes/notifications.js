import express from 'express';
import { getDB } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { ObjectId } from 'mongodb';

const router = express.Router();

/**
 * GET /api/notifications — the viewer's new-episode alerts (series monitor)
 * plus future server-side notification kinds. Newest first, 20 max.
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const rows = await db.collection('notifications')
      .find({ userId: new ObjectId(req.user.userId) })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();
    const unread = rows.filter((row) => !row.isRead).length;
    return res.json({ success: true, data: { notifications: rows, unread } });
  } catch (error) {
    console.error('notifications list error:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

/** POST /api/notifications/read-all — mark everything read. */
router.post('/read-all', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    await db.collection('notifications').updateMany(
      { userId: new ObjectId(req.user.userId), isRead: { $ne: true } },
      { $set: { isRead: true } },
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('notifications read-all error:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

export default router;
