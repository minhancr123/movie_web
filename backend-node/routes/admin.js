import express from 'express';
import { getDB } from '../config/database.js';
import { adminMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Get stats
import { getSiteSetting, setSiteSetting } from '../services/siteSettings.js';

// Public read for the client card components (60s Redis cache inside).
router.get('/site-settings/hover-trailer', async (req, res) => {
  const enabled = await getSiteSetting('hoverTrailer', false);
  res.json({ success: true, data: { enabled } });
});

// Admin toggle.
router.post('/site-settings/hover-trailer', adminMiddleware, async (req, res) => {
  try {
    await setSiteSetting('hoverTrailer', req.body?.enabled === true);
    res.json({ success: true, data: { enabled: req.body?.enabled === true } });
  } catch (error) {
    console.error('hover-trailer toggle error:', error.message);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

router.get('/stats', adminMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const totalUsers = await db.collection('users').countDocuments();
    const statsDoc = await db.collection('movie_stats').aggregate([
      { $group: { _id: null, totalViews: { $sum: '$views' } } }
    ]).toArray();
    
    const totalViews = statsDoc.length > 0 ? statsDoc[0].totalViews : 0;

    res.json({
      activeUsers: totalUsers,
      requestRate: 0,
      totalViews
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// Update rate-limit config
router.post('/rate-limit', adminMiddleware, async (req, res) => {
  try {
    const { limit } = req.body;
    res.json({ success: true, limit: limit || 100 });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

export default router;
