import { getDB } from '../config/database.js';
import { ObjectId } from 'mongodb';
import { parseContentRef } from '../services/contentRef.js';

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

    // movieSlug carries the contentRef since the TMDB cutover; store the parsed
    // identity alongside it so comments can be queried by tmdbId later.
    const identity = parseContentRef(req.body.contentRef || movieSlug || '');

    const comment = {
      userId: new ObjectId(userId),
      movieSlug,
      contentRef: identity?.contentRef ?? null,
      tmdbId: identity?.tmdbId ?? null,
      mediaType: identity?.mediaType ?? null,
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
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const skip = (page - 1) * limit;
    const db = getDB();

    // Get top-level comments (no parent) and the total count in parallel.
    const [comments, total] = await Promise.all([
      db.collection('comments')
        .find({ movieSlug, parentId: null })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      db.collection('comments').countDocuments({
        movieSlug,
        parentId: null
      })
    ]);

    // Fetch every reply referenced by this page in ONE query instead of one
    // round-trip per comment (N+1): a movie page with 10 commented threads
    // used to cost 12 sequential Mongo calls.
    const allReplyIds = comments.flatMap((comment) => comment.replies || []);
    if (allReplyIds.length > 0) {
      const replies = await db.collection('comments')
        .find({ _id: { $in: allReplyIds } })
        .sort({ createdAt: 1 })
        .toArray();
      const repliesByParent = new Map();
      for (const reply of replies) {
        const parentIdStr = String(reply._id);
        for (const comment of comments) {
          if ((comment.replies || []).some((id) => String(id) === parentIdStr)) {
            if (!repliesByParent.has(comment._id)) repliesByParent.set(comment._id, []);
            repliesByParent.get(comment._id).push(reply);
            break;
          }
        }
      }
      for (const comment of comments) {
        if (comment.replies && comment.replies.length > 0) {
          comment.repliesData = repliesByParent.get(comment._id) || [];
        }
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
