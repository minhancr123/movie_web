import express from 'express';
import { ObjectId } from 'mongodb';
import os from 'node:os';
import { statfs } from 'node:fs/promises';
import { getDB } from '../config/database.js';
import { cacheClient } from '../config/redis.js';
import { adminMiddleware } from '../middleware/auth.js';
import { getSiteSetting, setSiteSetting } from '../services/siteSettings.js';
import { adminTraffic } from '../services/admin/traffic.js';
import { getCatalogLimit, setCatalogLimit, validCatalogLimit, parseAdminList, literalSearch, USER_FIELDS, SESSION_FIELDS } from '../services/admin/policy.js';

const router = express.Router();
router.get('/site-settings/hover-trailer', async (_req, res) => {
  res.json({ success: true, data: { enabled: await getSiteSetting('hoverTrailer', false) } });
});
// Public read (player gate); the flip lives behind adminMiddleware below.
router.get('/site-settings/pause-overlay', async (_req, res) => {
  res.json({ success: true, data: { enabled: await getSiteSetting('pauseOverlay', true) } });
});
router.use(adminMiddleware);
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
const route = handler => async (req, res) => {
  try { await handler(req, res); }
  catch (error) { console.error('[admin]', req.path, error.message); res.status(500).json({ success: false, message: 'Không tải được dữ liệu quản trị. Vui lòng thử lại.' }); }
};
const audit = (req, action, details) => getDB().collection('admin_audit').insertOne({
  actor: String(req.user.userId), action, details, createdAt: new Date(),
}).catch(error => console.error('[admin-audit]', error.message));
router.post('/site-settings/hover-trailer', route(async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ success: false, message: 'enabled phải là true hoặc false.' });
  await setSiteSetting('hoverTrailer', req.body.enabled);
  await audit(req, 'hover-trailer', { enabled: req.body.enabled });
  res.json({ success: true, data: { enabled: req.body.enabled } });
}));
router.post('/site-settings/pause-overlay', route(async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ success: false, message: 'enabled phải là true hoặc false.' });
  await setSiteSetting('pauseOverlay', req.body.enabled);
  await audit(req, 'pause-overlay', { enabled: req.body.enabled });
  res.json({ success: true, data: { enabled: req.body.enabled } });
}));
router.get('/settings', route(async (_req, res) => {
  const [hoverTrailer, pauseOverlay, catalogRateLimit] = await Promise.all([getSiteSetting('hoverTrailer', false), getSiteSetting('pauseOverlay', true), getCatalogLimit()]);
  res.json({ success: true, data: { hoverTrailer, pauseOverlay, catalogRateLimit, windowSeconds: 60, scope: 'catalog' } });
}));
router.post('/rate-limit', route(async (req, res) => {
  if (!validCatalogLimit(req.body?.limit)) return res.status(400).json({ success: false, message: 'Giới hạn phải là số nguyên từ 30 đến 3000.' });
  await setCatalogLimit(req.body.limit, req.user.userId);
  await audit(req, 'catalog-rate-limit', { limit: req.body.limit });
  res.json({ success: true, limit: req.body.limit, scope: 'catalog', propagationSeconds: 10 });
}));
router.get('/stats', route(async (_req, res) => {
  const db = getDB(), now = new Date();
  const [totalUsers, admins, newUsers, views, pendingRequests, sessions, mongo, redis, disk] = await Promise.all([
    db.collection('users').countDocuments(), db.collection('users').countDocuments({ role: 'admin' }),
    db.collection('users').countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 86400000) } }),
    db.collection('movie_stats').aggregate([{ $group: { _id: null, total: { $sum: '$views' } } }]).toArray(),
    db.collection('movie_requests').countDocuments({ status: 'pending' }),
    db.collection('playback_sessions').countDocuments({ expiresAt: { $gt: now } }),
    db.command({ ping: 1 }).then(() => true).catch(() => false),
    cacheClient.ping().then(v => v === 'PONG').catch(() => false), statfs('.').catch(() => null),
  ]);
  res.json({ success: true, data: {
    totalUsers, admins, newUsers, totalViews: views[0]?.total || 0, pendingRequests, unexpiredSessions: sessions,
    traffic: adminTraffic.read(), measuredAt: now.toISOString(),
    system: { mongo, redis, uptimeSeconds: Math.floor(process.uptime()), hostUptimeSeconds: Math.floor(os.uptime()),
      cpuCores: os.cpus().length, loadAverage: os.loadavg(), memoryTotal: os.totalmem(), memoryFree: os.freemem(), processRss: process.memoryUsage().rss,
      diskTotal: disk ? disk.bsize * disk.blocks : null, diskFree: disk ? disk.bsize * disk.bavail : null,
      release: process.env.RELEASE_ID || 'development', nodeVersion: process.version },
  } });
}));
router.get('/users', route(async (req, res) => {
  const { page, limit, search, role } = parseAdminList(req.query), query = {};
  // Older Google-created accounts have no explicit role; their effective role
  // is user, exactly as the token issuer and admin table already treat them.
  if (role) query.role = role === 'user' ? { $in: ['user', null] } : 'admin';
  if (search) query.$or = ['email', 'username'].map(key => ({ [key]: { $regex: literalSearch(search), $options: 'i' } }));
  const collection = getDB().collection('users');
  const [total, data] = await Promise.all([collection.countDocuments(query), collection.find(query, { projection: USER_FIELDS }).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray()]);
  res.json({ success: true, data, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
}));
router.get('/users/:id/activity', route(async (req, res) => {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ success: false, message: 'Mã tài khoản không hợp lệ.' });
  const db = getDB(), id = new ObjectId(req.params.id);
  const user = await db.collection('users').findOne({ _id: id }, { projection: USER_FIELDS });
  if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản.' });
  const [events, history] = await Promise.all([
    db.collection('auth_events').find({ userIdStr: String(id) }, { projection: {
      at: 1, provider: 1, action: 1, outcome: 1, ip: 1, ipSource: 1, userAgent: 1, device: 1, evidence: 1, note: 1,
    } }).sort({ at: -1 }).limit(50).toArray(),
    db.collection('watch_history').find({ $or: [{ userId: id }, { userId: String(id) }] }, { projection: {
      movieData: { name: 1 }, tmdbId: 1, mediaType: 1, watchedAt: 1, currentTime: 1, episode: 1,
    } }).sort({ watchedAt: -1 }).limit(10).toArray(),
  ]);
  res.json({ success: true, data: { user, events, history, retentionDays: 60 } });
}));
router.get('/sessions', route(async (req, res) => {
  const { page, limit } = parseAdminList(req.query);
  const query = req.query.scope === 'all' ? {} : { expiresAt: { $gt: new Date() } };
  const collection = getDB().collection('playback_sessions');
  const [total, data] = await Promise.all([collection.countDocuments(query), collection.find(query, { projection: SESSION_FIELDS }).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray()]);
  res.json({ success: true, data, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
}));
router.get('/audit', route(async (_req, res) => {
  const data = await getDB().collection('admin_audit').find({}, { projection: { actor: 1, action: 1, details: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(50).toArray();
  res.json({ success: true, data });
}));
export default router;
