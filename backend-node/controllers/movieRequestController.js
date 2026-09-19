import { getDB } from '../config/database.js';
import { ObjectId } from 'mongodb';

/**
 * @route POST /api/movie-requests
 * @access Private (Authed User)
 */
export const createRequest = async (req, res) => {
  try {
    const { title, tmdbId, note } = req.body;
    const { userId, username, email } = req.user;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Tiêu đề phim không được để trống.' });
    }

    if (title.length > 200) {
      return res.status(400).json({ success: false, message: 'Tiêu đề phim quá dài (tối đa 200 ký tự).' });
    }

    const db = getDB();
    
    // Optional: Rate limit check (e.g., max 10 pending requests)
    const pendingCount = await db.collection('movie_requests').countDocuments({
      userId: new ObjectId(userId),
      status: 'pending'
    });

    if (pendingCount >= 10) {
      return res.status(429).json({ 
        success: false, 
        message: 'Bạn đang có quá nhiều yêu cầu đang chờ xử lý. Vui lòng đợi chúng tôi xử lý xong trước khi gửi thêm.' 
      });
    }

    const newRequest = {
      title: title.trim(),
      tmdbId: tmdbId || null,
      userId: new ObjectId(userId),
      username: username || email || 'Ẩn danh',
      status: 'pending',
      note: note || '',
      adminNote: '',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('movie_requests').insertOne(newRequest);

    res.status(201).json({
      success: true,
      message: 'Gửi yêu cầu thành công! Chúng tôi sẽ sớm cập nhật phim này.',
      request: { ...newRequest, _id: result.insertedId }
    });
  } catch (error) {
    console.error('[createRequest] error:', error);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống khi gửi yêu cầu.' });
  }
};

/**
 * @route GET /api/movie-requests
 * @access Private (Admin only)
 */
export const getRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const db = getDB();

    const query = {};
    if (status && ['pending', 'completed', 'rejected'].includes(status)) {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await db.collection('movie_requests').countDocuments(query);
    
    const requests = await db.collection('movie_requests')
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    res.json({
      success: true,
      data: requests,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('[getRequests] error:', error);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống khi lấy danh sách yêu cầu.' });
  }
};

/**
 * @route GET /api/movie-requests/me
 * @access Private (Authed User)
 */
export const getMyRequests = async (req, res) => {
  try {
    const { userId } = req.user;
    const db = getDB();

    const requests = await db.collection('movie_requests')
      .find({ userId: new ObjectId(userId) })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: requests });
  } catch (error) {
    console.error('[getMyRequests] error:', error);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống khi lấy yêu cầu của bạn.' });
  }
};

/**
 * @route PUT /api/movie-requests/:id
 * @access Private (Admin only)
 */
export const updateRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNote } = req.body;

    if (!status || !['pending', 'completed', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ.' });
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'ID yêu cầu không hợp lệ.' });
    }

    const db = getDB();
    const result = await db.collection('movie_requests').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          status, 
          adminNote: adminNote || '',
          updatedAt: new Date() 
        } 
      },
      { returnDocument: 'after' }
    );

    if (!result.value) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu.' });
    }

    res.json({
      success: true,
      message: 'Cập nhật trạng thái thành công.',
      request: result.value
    });
  } catch (error) {
    console.error('[updateRequestStatus] error:', error);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống khi cập nhật yêu cầu.' });
  }
};
