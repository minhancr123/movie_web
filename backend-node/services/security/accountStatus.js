import { ObjectId } from 'mongodb';

/** A short cache bounds DB reads; status changes propagate within 3 seconds. */
export const createAccountStatus = (load, now = Date.now) => {
  const entries = new Map();
  return {
    invalidate: id => entries.delete(String(id)),
    async blocked(id) {
      const key = String(id || '');
      const old = entries.get(key);
      if (old && old.until > now()) return old.blocked;
      const user = await load(key);
      const blocked = !user || user.isBanned === true;
      if (entries.size >= 2000) entries.clear();
      entries.set(key, { blocked, until: now() + 3000 });
      return blocked;
    },
  };
};
export const accountStatus = createAccountStatus(async id => {
  const { getDB } = await import('../../config/database.js');
  return getDB().collection('users').findOne({ _id: new ObjectId(id) }, { projection: { isBanned: 1 } });
});
export const enforceAccountStatus = (req, res, next) => {
  // Legacy signed service/guest identities do not represent an account row.
  if (!/^[a-f0-9]{24}$/i.test(String(req.user?.userId || ''))) return next();
  return accountStatus.blocked(req.user.userId).then(blocked => {
    if (blocked) return res.status(403).json({ success: false, code: 'ACCOUNT_BANNED', message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' });
    return next();
  }).catch(() => res.status(503).json({ success: false, message: 'Chưa kiểm tra được trạng thái tài khoản. Vui lòng thử lại.' }));
};
export const canModerateAccount = (actorId, user) => user && String(actorId) !== String(user._id) && user.role !== 'admin';
