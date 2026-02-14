import { getDB } from '../config/database.js';
import { ObjectId } from 'mongodb';

// Create premiere event
export const createPremiereEvent = async (req, res) => {
  try {
    const { movieSlug, name, posterUrl, thumbUrl, startTime } = req.body;
    const userId = req.user.userId;
    const db = getDB();

    const event = {
      movieSlug,
      name,
      posterUrl,
      thumbUrl,
      startTime: new Date(startTime),
      status: 'scheduled', // scheduled, live, ended
      createdBy: new ObjectId(userId),
      createdAt: new Date(),
      notifiedUsers: []
    };

    const result = await db.collection('premiere_events').insertOne(event);

    res.status(201).json({
      success: true,
      message: 'Đã tạo sự kiện công chiếu',
      event: {
        ...event,
        _id: result.insertedId
      }
    });
  } catch (error) {
    console.error('Create premiere error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Get all premiere events
export const getPremiereEvents = async (req, res) => {
  try {
    const status = req.query.status; // scheduled, live, ended
    const limit = parseInt(req.query.limit) || 20;
    const db = getDB();

    const query = status ? { status } : {};
    
    const events = await db.collection('premiere_events')
      .find(query)
      .sort({ startTime: 1 })
      .limit(limit)
      .toArray();

    res.json({
      success: true,
      events
    });
  } catch (error) {
    console.error('Get premiere events error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Get upcoming premieres (next 7 days)
export const getUpcomingPremieres = async (req, res) => {
  try {
    const db = getDB();
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const events = await db.collection('premiere_events')
      .find({
        status: 'scheduled',
        startTime: { $gte: now, $lte: nextWeek }
      })
      .sort({ startTime: 1 })
      .toArray();

    res.json({
      success: true,
      events
    });
  } catch (error) {
    console.error('Get upcoming premieres error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Get premiere by movie slug
export const getPremiereBySlug = async (req, res) => {
  try {
    const { movieSlug } = req.params;
    const db = getDB();

    const event = await db.collection('premiere_events').findOne({ 
      movieSlug,
      status: { $in: ['scheduled', 'live'] }
    });

    res.json({
      success: true,
      event
    });
  } catch (error) {
    console.error('Get premiere by slug error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Update event status (for cron job or manual update)
export const updateEventStatus = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { status } = req.body;
    const db = getDB();

    await db.collection('premiere_events').updateOne(
      { _id: new ObjectId(eventId) },
      { $set: { status, updatedAt: new Date() } }
    );

    res.json({
      success: true,
      message: 'Đã cập nhật trạng thái sự kiện'
    });
  } catch (error) {
    console.error('Update event status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Delete premiere event
export const deletePremiereEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.userId;
    const db = getDB();

    // Check if event belongs to user
    const event = await db.collection('premiere_events').findOne({ 
      _id: new ObjectId(eventId) 
    });

    if (!event) {
      return res.status(404).json({ 
        success: false, 
        message: 'Không tìm thấy sự kiện' 
      });
    }

    if (event.createdBy.toString() !== userId.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Bạn không có quyền xóa sự kiện này' 
      });
    }

    await db.collection('premiere_events').deleteOne({ 
      _id: new ObjectId(eventId) 
    });

    res.json({
      success: true,
      message: 'Đã xóa sự kiện'
    });
  } catch (error) {
    console.error('Delete premiere event error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};

// Register for premiere notification
export const registerForNotification = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.userId;
    const db = getDB();

    await db.collection('premiere_events').updateOne(
      { _id: new ObjectId(eventId) },
      { $addToSet: { notifiedUsers: new ObjectId(userId) } }
    );

    res.json({
      success: true,
      message: 'Đã đăng ký nhận thông báo'
    });
  } catch (error) {
    console.error('Register notification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Lỗi server' 
    });
  }
};
