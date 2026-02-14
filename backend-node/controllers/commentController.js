import { getDB } from '../config/database.js';
import { ObjectId } from 'mongodb';

// Add comment
export const addComment = async (req, res) => {
  try {
    const { movieSlug, content, parentId } = req.body;
    const userId = req.user.userId;
    const db = getDB();

    // Get user info
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { username: 1, avatar: 1, fullName: 1 } }
    );

    const comment = {
      userId: new ObjectId(userId),
      movieSlug,
      content: content.trim(),
      parentId: parentId ? new ObjectId(parentId) : null,
      user: {
        username: user.username,
        avatar: user.avatar,
        fullName: user.fullName
      },
      likes: 0,
      replies: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('comments').insertOne(comment);

    // If it's a reply, add to parent's replies array
    if (parentId) {
      await db.collection('comments').updateOne(
        { _id: new ObjectId(parentId) },
        { $push: { replies: result.insertedId } }
      );
    }

    res.status(201).json({
      success: true,
      message: 'Đã thêm bình luận',
      comment: {
        ...comment,
        _id: result.insertedId
      }
    });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Get comments for a movie
export const getComments = async (req, res) => {
  try {
    const { movieSlug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const db = getDB();

    // Get top-level comments (no parent)
    const comments = await db.collection('comments')
      .find({ movieSlug, parentId: null })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Get total count
    const total = await db.collection('comments').countDocuments({ 
      movieSlug, 
      parentId: null 
    });

    // Get replies for each comment
    for (let comment of comments) {
      if (comment.replies && comment.replies.length > 0) {
        const replies = await db.collection('comments')
          .find({ _id: { $in: comment.replies } })
          .sort({ createdAt: 1 })
          .toArray();
        comment.repliesData = replies;
      }
    }

    res.json({
      success: true,
      comments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Delete comment
export const deleteComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.userId;
    const db = getDB();

    // Check if comment belongs to user
    const comment = await db.collection('comments').findOne({ 
      _id: new ObjectId(commentId) 
    });

    if (!comment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Không tìm thấy bình luận' 
      });
    }

    if (comment.userId.toString() !== userId.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Bạn không có quyền xóa bình luận này' 
      });
    }

    // Delete comment and its replies
    await db.collection('comments').deleteMany({ 
      $or: [
        { _id: new ObjectId(commentId) },
        { parentId: new ObjectId(commentId) }
      ]
    });

    res.json({
      success: true,
      message: 'Đã xóa bình luận'
    });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Update comment
export const updateComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { content } = req.body;
    const userId = req.user.userId;
    const db = getDB();

    // Check if comment belongs to user
    const comment = await db.collection('comments').findOne({ 
      _id: new ObjectId(commentId) 
    });

    if (!comment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Không tìm thấy bình luận' 
      });
    }

    if (comment.userId.toString() !== userId.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Bạn không có quyền sửa bình luận này' 
      });
    }

    // Update comment
    await db.collection('comments').updateOne(
      { _id: new ObjectId(commentId) },
      { 
        $set: { 
          content: content.trim(),
          updatedAt: new Date()
        } 
      }
    );

    res.json({
      success: true,
      message: 'Đã cập nhật bình luận'
    });
  } catch (error) {
    console.error('Update comment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};
