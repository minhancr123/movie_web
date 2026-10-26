import { initialAutomation } from '../services/requests/policy.js';
import { notifyRequestCompleted } from '../services/requests/notifications.js';
import { getDB } from '../config/database.js';
import { ObjectId } from 'mongodb';
import { search as tmdbSearch } from '../services/tmdb.js';
import { movieRequestMatches } from '../services/movieRequestMatches.js';

/** Collapse whitespace/case so "Dune  2" and "dune 2" dedupe to one row. */
const normalizeTitle = (title) =>
  String(title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Cap the roster so a viral title cannot grow one document forever. */
const REQUESTERS_CAP = 50;

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

    const requester = { id: new ObjectId(userId), name: username || email || 'Ẩn danh', at: new Date() };
    const dedupeQuery = tmdbId
      ? { status: 'pending', $or: [{ tmdbId: Number(tmdbId) }, { normalizedTitle: normalizeTitle(title) }] }
      : { status: 'pending', normalizedTitle: normalizeTitle(title) };
    const existing = await db.collection('movie_requests').findOne(dedupeQuery);

    if (existing) {
      const already = (existing.requesters || []).some(r => String(r.id) === String(requester.id));
      const push = already
        ? {}
        : { $push: { requesters: { $each: [requester], $slice: -REQUESTERS_CAP } } };
      await db.collection('movie_requests').updateOne(
        { _id: existing._id },
        {
          ...push,
          $set: { updatedAt: new Date() },
          $inc: already ? {} : { requestCount: 1 },
        },
      );
      return res.status(200).json({
        success: true,
        message: already
          ? 'Bạn đã gửi yêu cầu phim này rồi — đang trong hàng chờ.'
          : `Phim này đã có ${(existing.requesters?.length || 1)} người yêu cầu trước đó — đã thêm bạn vào danh sách.`,
        request: existing,
        joined: true,
      });
    }

    const newRequest = {
      title: title.trim(),
      normalizedTitle: normalizeTitle(title),
      tmdbId: tmdbId || null,
      userId: new ObjectId(userId),
      username: username || email || 'Ẩn danh',
      requesters: [requester],
      requestCount: 1,
      status: 'pending',
      automation: initialAutomation(),
      mediaType: ['movie','tv'].includes(req.body.mediaType) ? req.body.mediaType : 'movie',
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
    const { status, page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const db = getDB();

    const query = {};
    if (status && ['pending', 'completed', 'rejected'].includes(status)) {
      query.status = status;
    }

    const safePage = Math.max(parseInt(page) || 1, 1);
    const skip = (safePage - 1) * limit;
    const total = await db.collection('movie_requests').countDocuments(query);
    
    const requests = await db.collection('movie_requests')
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      success: true,
      data: requests,
      pagination: {
        total,
        page: safePage,
        limit,
        pages: Math.ceil(total / limit)
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
      .find({ $or: [{ userId: new ObjectId(userId) }, { 'requesters.id': new ObjectId(userId) }] })
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
    const { status, adminNote, tmdbId, mediaType } = req.body;

    if (status !== undefined && !['pending', 'completed', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ.' });
    }
    if (status === undefined && tmdbId === undefined) {
      return res.status(400).json({ success: false, message: 'Cần trạng thái hoặc tmdbId để cập nhật.' });
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'ID yêu cầu không hợp lệ.' });
    }

    const db = getDB();
    const current = await db.collection('movie_requests').findOne({ _id: new ObjectId(id) });
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu.' });
    if (status === 'completed' && (current.automation?.state !== 'ready' || tmdbId !== undefined || mediaType !== undefined)) return res.status(409).json({ success: false, message: 'Nguồn chưa qua kiểm tra. Hãy cho hệ thống tìm và kiểm tra trước khi báo có phim.' });
    if (mediaType !== undefined && !['movie','tv'].includes(mediaType)) return res.status(400).json({ success: false, message: 'Loại phim không hợp lệ.' });
    const set = { updatedAt: new Date() };
    if (mediaType !== undefined) set.mediaType = mediaType;
    const resetAutomation = tmdbId !== undefined || mediaType !== undefined || status === 'pending';
    if (resetAutomation) set.automation = initialAutomation();
    if (status !== undefined) set.status = status;
    if (adminNote !== undefined) set.adminNote = adminNote;
    if (tmdbId !== undefined) {
      const n = Number(tmdbId);
      if (!Number.isInteger(n) || n <= 0) {
        return res.status(400).json({ success: false, message: 'tmdbId phải là số dương.' });
      }
      set.tmdbId = n;
    }
    const result = await db.collection('movie_requests').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: set },
      { returnDocument: 'after' }
    );
    // mongodb driver 6 returns the updated document directly; older drivers
    // wrapped it in {value}. Handle both or a successful update reads as 404.
    const updated = result?.value ?? result;

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu.' });
    }

    if (status === 'rejected' || resetAutomation) await db.collection('movie_request_jobs').updateOne({ _id: new ObjectId(id) },
      { $set: { state: status === 'rejected' ? 'cancelled' : 'retargeted' }, $unset: { source: '', failedHashes: '' } });
    const notified = status === 'completed' ? await notifyRequestCompleted(db, updated) : 0;

    res.json({
      success: true,
      message: notified > 0
        ? `Cập nhật thành công — đã thông báo cho ${notified} người yêu cầu.`
        : 'Cập nhật trạng thái thành công.',
      request: updated
    });
  } catch (error) {
    console.error('[updateRequestStatus] error:', error);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống khi cập nhật yêu cầu.' });
  }
};
/**
 * @route GET /api/movie-requests/:id/tmdb
 * @access Private (Admin only)
 * Search TMDB for the requested title so the admin can attach the right id
 * without leaving the moderation tab. Same normalization as the dedupe so a
 * messy request title still finds its film.
 */
export const checkTmdbMatch = async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'ID yêu cầu không hợp lệ.' });
    }
    const db = getDB();
    const request = await db.collection('movie_requests').findOne({ _id: new ObjectId(id) });
    if (!request) return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu.' });

    const payload = await tmdbSearch(request.title);
    const results = movieRequestMatches(payload);
    res.json({ success: true, data: { title: request.title, attachedTmdbId: request.tmdbId || null, results } });
  } catch (error) {
    console.error('[checkTmdbMatch] error:', error);
    res.status(500).json({ success: false, message: 'Không tra cứu được TMDB lúc này.' });
  }
};

/** Explicit retry/pause never silently changes completed/rejected requests. */
export const controlRequestAutomation = async (req,res) => {
  if (!ObjectId.isValid(req.params.id) || typeof req.body?.enabled !== 'boolean') return res.status(400).json({success:false,message:'Trạng thái không hợp lệ.'});
  const set = { 'automation.enabled':req.body.enabled, 'automation.state':req.body.enabled?'queued':'paused',
    'automation.nextAttemptAt':new Date(), 'automation.priority':1, updatedAt:new Date() };
  for(const field of ['season','episode']) if(req.body[field]!==undefined){
    if(!Number.isInteger(req.body[field])||req.body[field]<(field==='season'?0:1)||req.body[field]>999)return res.status(400).json({success:false,message:'Mùa/tập không hợp lệ.'});
    set[field]=req.body[field];
  }
  const changed=await getDB().collection('movie_requests').updateOne({_id:new ObjectId(req.params.id),status:'pending'},
    {$set:set,$unset:{'automation.lease':'','automation.leaseUntil':''}});
  if(!changed.matchedCount)return res.status(409).json({success:false,message:'Chỉ xử lý tự động yêu cầu đang chờ.'});
  if(req.body.enabled) await getDB().collection('movie_request_jobs').updateOne({_id:new ObjectId(req.params.id),state:{$ne:'downloading'}},{$unset:{source:'',failedHashes:''}});
  res.json({success:true});
};
