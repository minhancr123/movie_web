import crypto from 'node:crypto';
import { retryAt, initialAutomation } from './policy.js';
import { notifyRequestCompleted } from './notifications.js';

/** Mongo leases survive restarts and prevent multiple API processes preparing
 * the same request. Only one uncached download is admitted by the global lease. */
export function createRequestWorker({ db, adapter, now = Date.now, enabled = true, notify = notifyRequestCompleted }) {
  let running = false;
  const requests = db.collection('movie_requests'), jobs = db.collection('movie_request_jobs');
  const patch = (row, state, message, extra = {}) => requests.updateOne({ _id: row._id, status: 'pending', 'automation.lease': row.automation.lease }, {
    $set: { 'automation.state': state, 'automation.message': message, 'automation.lastCheckedAt': new Date(now()),
      'automation.nextAttemptAt': retryAt(state, now()), 'automation.priority': state === 'downloading' ? 0 : state === 'waiting_source' ? 2 : 1,
      updatedAt: new Date(now()), ...extra },
  });
  const tick = async () => {
    if (!enabled || running) return;
    running = true;
    const lease = crypto.randomUUID();
    let row;
    try {
      const locked = await db.collection('request_worker_locks').findOneAndUpdate({ _id: 'movie-requests', $or: [{ until: { $lte: new Date(now()) } }, { until: { $exists: false } }] },
        { $set: { until: new Date(now()+4*60000), lease } }, { upsert: true, returnDocument: 'after' }).catch(e => { if (e.code === 11000) return null; throw e; });
      if (!locked) return;
      const unsent = await requests.findOne({ status: 'completed', 'automation.state': 'ready', 'automation.notifiedAt': { $exists: false } });
      if (unsent) {
        await notify(db, unsent);
        await requests.updateOne({ _id: unsent._id, status: 'completed' }, { $set: { 'automation.notifiedAt': new Date(now()) } });
      }
      await requests.updateMany({ status: 'pending', automation: { $exists: false } }, { $set: { automation: initialAutomation() } });
      row = await requests.findOneAndUpdate({ status: 'pending', 'automation.enabled': { $ne: false },
        $and: [{ $or: [{ 'automation.nextAttemptAt': { $lte: new Date(now()) } }, { 'automation.nextAttemptAt': { $exists: false } }] },
          { $or: [{ 'automation.leaseUntil': { $lte: new Date(now()) } }, { 'automation.leaseUntil': { $exists: false } }] }] },
      { $set: { 'automation.lease': lease, 'automation.leaseUntil': new Date(now()+4*60000), 'automation.state': 'searching' }, $inc: { 'automation.attempts': 1 } },
      { sort: { 'automation.priority': 1, createdAt: 1 }, returnDocument: 'after' });
      if (!row) return;
      let job = await jobs.findOne({ _id: row._id });
      const detail = await adapter.detail(row);
      if (!detail) { await patch(row, 'needs_match', 'Chưa xác định chắc chắn đúng phim. Chọn kết quả TMDB trong admin.'); return; }
      if (detail.mediaType === 'tv' && !(Number.isInteger(row.season) && Number.isInteger(row.episode))) {
        await patch(row, 'needs_match', 'Phim bộ cần xác định mùa và tập trước khi tự tải.'); return;
      }
      await requests.updateOne({ _id: row._id, status: 'pending', 'automation.lease': lease }, { $set: { tmdbId: detail.tmdbId, mediaType: detail.mediaType } });
      const key = await adapter.key(row);
      const scope = adapter.scope?.(key) || null;
      const source = job?.source && (job.credentialScope || null) === scope && job.tmdbId === detail.tmdbId && job.mediaType === detail.mediaType
        && (job.season ?? null) === (row.season ?? null) && (job.episode ?? null) === (row.episode ?? null) ? job.source : null;
      let candidate = source;
      if (!candidate) {
        const found = await adapter.discover(detail, row, key);
        const rejected = new Set((job?.credentialScope || null) === scope ? job?.failedHashes || [] : []);
        candidate = found.find(x => !rejected.has(x.infoHash || x.sourceToken) && (x.cached || x.kind === 'direct' || (x.sizeBytes > 0 && x.sizeBytes <= 20*1024**3)));
        if (!candidate) { if (found.length) await jobs.updateOne({ _id: row._id }, { $unset: { failedHashes: '' } }); await patch(row, 'waiting_source', 'Chưa tìm thấy bản phù hợp. Hệ thống tự tìm lại sau 6 giờ.', { 'automation.progress': 0 }); return; }
        if (!candidate.cached && candidate.kind !== 'direct') {
          const active = await jobs.countDocuments({ state: 'downloading', _id: { $ne: row._id } });
          const daily = await db.collection('movie_request_downloads').countDocuments({ createdAt: { $gte: new Date(now()-86400000) } });
          if (active >= 1 || daily >= 3) { await patch(row, 'waiting_slot', 'Đang chờ lượt tải nền (tối đa 1 phim, 3 lượt tải mới mỗi ngày).'); return; }
          if (!(candidate.sizeBytes > 0) || candidate.sizeBytes > 20*1024**3) {
            await patch(row, 'waiting_source', 'Chờ bản có dung lượng xác định dưới 20 GiB để tải nền an toàn.'); return;
          }
        }
        await jobs.updateOne({ _id: row._id }, { $set: { source: adapter.persist(candidate), credentialScope: scope, tmdbId: detail.tmdbId, mediaType: detail.mediaType,
          season: row.season ?? null, episode: row.episode ?? null,
          progress: 0, lastProgressAt: new Date(now()),
          state: !candidate.cached && candidate.kind !== 'direct' ? 'downloading' : 'preparing', ...(!candidate.cached && candidate.kind !== 'direct' ? { downloadStartedAt: new Date(now()) } : {}) } }, { upsert: true });
        job = { progress: 0, lastProgressAt: new Date(now()) };
      }
      if (!candidate.cached && candidate.kind !== 'direct' && !source) {
        await db.collection('movie_request_downloads').updateOne({ _id: `${row._id}:${candidate.infoHash}:${Math.floor(now()/86400000)}` },
          { $setOnInsert: { requestId: row._id, createdAt: new Date(now()) } }, { upsert: true });
      }
      const prepared = await adapter.prepare(candidate, key, row);
      if (prepared.state !== 'ready') {
        const progress = Number(prepared.progress) || 0;
        const lastProgressAt = progress > (job?.progress || 0) ? new Date(now()) : job?.lastProgressAt || new Date(now());
        if (now() - new Date(lastProgressAt).getTime() > 30*60000) {
          await jobs.updateOne({ _id: row._id }, { $unset: { source: '' }, $set: { state: 'stalled' }, $addToSet: { failedHashes: candidate.infoHash || candidate.sourceToken } });
          await patch(row, 'waiting_source', 'Nguồn tải không tiến triển 30 phút; sẽ tìm bản khác.'); return;
        }
        await jobs.updateOne({ _id: row._id }, { $set: { source: { ...adapter.persist(candidate), torrentId: prepared.torrentId },
          state: 'downloading', progress, lastProgressAt } });
        await patch(row, 'downloading', 'TorBox đang tải phim nền.', { 'automation.progress': progress }); return;
      }
      await patch(row, 'verifying', 'Đang kiểm tra đúng phim, dữ liệu video và âm thanh.', { 'automation.progress': 100 });
      const verified = await adapter.verify(candidate, prepared, detail, row, key);
      if (!verified) {
        await jobs.updateOne({ _id: row._id }, { $unset: { source: '' }, $set: { state: 'failed' }, $addToSet: { failedHashes: candidate.infoHash || candidate.sourceToken } });
        await patch(row, 'waiting_source', 'Bản tìm thấy chưa vượt qua kiểm tra; sẽ thử bản khác.', { 'automation.nextAttemptAt': new Date(now()+60000) }); return;
      }
      // A rejected/paused/retargeted request must never be completed by an old job.
      const still = await requests.findOne({ _id: row._id, status: 'pending', 'automation.enabled': { $ne: false }, 'automation.lease': lease,
        tmdbId: detail.tmdbId, mediaType: detail.mediaType });
      if (!still) return;
      await adapter.publish(candidate, prepared, detail, row, key, verified);
      const done = await requests.findOneAndUpdate({ _id: row._id, status: 'pending', 'automation.enabled': { $ne: false }, 'automation.lease': lease }, {
        $set: { status: 'completed', 'automation.state': 'ready', 'automation.progress': 100, 'automation.message': 'Nguồn đã qua kiểm tra và sẵn sàng phát.',
          'automation.verifiedAt': new Date(now()), updatedAt: new Date(now()) },
      }, { returnDocument: 'after' });
      if (done) { await notify(db, done); await requests.updateOne({ _id: done._id, status: 'completed' }, { $set: { 'automation.notifiedAt': new Date(now()) } }); }
      await jobs.updateOne({ _id: row._id }, { $set: { state: 'ready' } });
    } catch (error) {
      if (row) await jobs.updateOne({ _id: row._id, state: { $ne: 'downloading' } }, { $unset: { source: '' } }).catch(() => {});
      if (row && error.code === 'not_found') await jobs.updateOne({ _id: row._id }, { $unset: { source: '' }, $set: { state: 'failed' } }).catch(() => {});
      if (row) await patch(row, 'waiting_provider', ['plan_restricted','invalid_token','no_connection'].includes(error.code)
        ? 'Cần kiểm tra kết nối hoặc gói TorBox trong admin.' : 'Dịch vụ nguồn đang chậm hoặc lỗi; tự thử lại sau 5 phút.').catch(() => {});
      console.warn('[movie-requests] background attempt deferred', error.code || error.name || 'error');
    } finally {
      if (row) await requests.updateOne({ _id: row._id, 'automation.lease': lease }, { $unset: { 'automation.lease': '', 'automation.leaseUntil': '' } }).catch(() => {});
      await db.collection('request_worker_locks').updateOne({ _id: 'movie-requests', lease }, { $set: { until: new Date(now()) } }).catch(() => {});
      running = false;
    }
  };
  return { tick };
}
