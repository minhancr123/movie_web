import { getDB } from '../config/database.js';
import { ObjectId } from 'mongodb';

// Add to favorites
export const addFavorite = async (req, res) => {
  try {
    const { movieSlug, movieData } = req.body;
    const userId = req.user.userId;
    const db = getDB();

    // Check if already exists
    const existing = await db.collection('favorites').findOne({ 
      userId: new ObjectId(userId), 
      movieSlug 
    });

    if (existing) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phim đã có trong danh sách yêu thích' 
      });
    }

    // Add to favorites
    const favorite = {
      userId: new ObjectId(userId),
      movieSlug,
      movieData: {
        name: movieData.name,
        originName: movieData.originName,
        posterUrl: movieData.posterUrl,
        thumbUrl: movieData.thumbUrl,
        year: movieData.year
      },
      addedAt: new Date()
    };

    await db.collection('favorites').insertOne(favorite);

    res.status(201).json({
      success: true,
      message: 'Đã thêm vào yêu thích'
    });
  } catch (error) {
    console.error('Add favorite error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Remove from favorites
export const removeFavorite = async (req, res) => {
  try {
    const { movieSlug } = req.params;
    const userId = req.user.userId;
    const db = getDB();

    const result = await db.collection('favorites').deleteOne({ 
      userId: new ObjectId(userId), 
      movieSlug 
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Không tìm thấy phim trong danh sách' 
      });
    }

    res.json({
      success: true,
      message: 'Đã xóa khỏi yêu thích'
    });
  } catch (error) {
    console.error('Remove favorite error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Get user's favorites
export const getFavorites = async (req, res) => {
  try {
    const userId = req.user.userId;
    const db = getDB();

    const favorites = await db.collection('favorites')
      .find({ userId: new ObjectId(userId) })
      .sort({ addedAt: -1 })
      .toArray();

    res.json({
      success: true,
      favorites
    });
  } catch (error) {
    console.error('Get favorites error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Check if movie is favorited
export const checkFavorite = async (req, res) => {
  try {
    const { movieSlug } = req.params;
    const userId = req.user.userId;
    const db = getDB();

    const favorite = await db.collection('favorites').findOne({ 
      userId: new ObjectId(userId), 
      movieSlug 
    });

    res.json({
      success: true,
      isFavorite: !!favorite
    });
  } catch (error) {
    console.error('Check favorite error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};
