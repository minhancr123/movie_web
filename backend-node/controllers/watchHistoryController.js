import { getDB } from '../config/database.js';
import { ObjectId } from 'mongodb';

// Add or update watch history
export const addWatchHistory = async (req, res) => {
  try {
    const { movieSlug, movieData, episode, server, currentTime } = req.body;
    const userId = req.user.userId;
    const db = getDB();

    // Check if already exists
    const existing = await db.collection('watch_history').findOne({ 
      userId: new ObjectId(userId), 
      movieSlug 
    });

    if (existing) {
      // Update existing
      await db.collection('watch_history').updateOne(
        { userId: new ObjectId(userId), movieSlug },
        { 
          $set: { 
            episode,
            server,
            currentTime,
            watchedAt: new Date()
          } 
        }
      );
    } else {
      // Insert new
      const history = {
        userId: new ObjectId(userId),
        movieSlug,
        movieData: {
          name: movieData.name,
          originName: movieData.originName,
          posterUrl: movieData.posterUrl,
          thumbUrl: movieData.thumbUrl,
          year: movieData.year
        },
        episode,
        server,
        currentTime: currentTime || 0,
        watchedAt: new Date()
      };

      await db.collection('watch_history').insertOne(history);
    }

    res.json({
      success: true,
      message: 'Đã lưu lịch sử xem'
    });
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
    const limit = parseInt(req.query.limit) || 20;
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
