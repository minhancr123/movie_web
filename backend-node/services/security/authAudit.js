import { isIP } from 'node:net';

const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '';
export const describeUserAgent = raw => {
  const ua = clean(raw, 1024);
  const browser = /Edg\//.test(ua) ? 'Edge' : /(?:OPR|Opera)\//.test(ua) ? 'Opera'
    : /(?:Chrome|CriOS)\//.test(ua) ? 'Chrome' : /(?:Firefox|FxiOS)\//.test(ua) ? 'Firefox'
      : /Safari\//.test(ua) ? 'Safari' : /CFNetwork\//.test(ua) ? 'Ứng dụng Apple' : 'Không xác định';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS / iPadOS'
    : /Windows/i.test(ua) ? 'Windows' : /Macintosh|Mac OS X/i.test(ua) ? 'macOS'
      : /Linux|X11/i.test(ua) ? 'Linux' : 'Không xác định';
  const type = /iPad|Tablet/i.test(ua) ? 'Máy tính bảng' : /Mobile|iPhone|iPod|Android/i.test(ua) ? 'Di động' : ua ? 'Máy tính / ứng dụng' : 'Không xác định';
  return { browser, os, type };
};
export const authMetadata = req => {
  // Express req.ip follows the configured trusted proxy hop. Never read an
  // arbitrary client-supplied CF/X-Real-IP header here.
  const candidate = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  const ip = isIP(candidate) && !['127.0.0.1', '::1'].includes(candidate) ? candidate : null;
  const userAgent = clean(req.headers?.['user-agent'], 1024);
  return { ip, ipSource: ip ? 'request-ip' : 'unavailable', userAgent, device: describeUserAgent(userAgent) };
};
export const recordAuthEvent = async (req, { user, provider, action, outcome = 'success' }) => {
  try {
    const { getDB } = await import('../../config/database.js');
    const db = getDB(), at = new Date(), metadata = authMetadata(req);
    const event = { userIdStr: user?._id ? String(user._id) : null, provider, action, outcome,
      at, ...metadata, evidence: 'auth-handler' };
    await db.collection('auth_events').insertOne(event);
    if (user?._id && outcome === 'success') {
      const lastLogin = { at, provider, ...metadata };
      await db.collection('users').updateOne({ _id: user._id }, { $set: {
        lastLogin, ...(action === 'register' ? { registration: lastLogin } : {}),
      } });
    }
  } catch (error) {
    // Audit failure must not disclose credentials or turn a valid login into
    // a failed one. No request bodies, cookies or JWTs are written here.
    console.error('[auth-audit] Unable to persist event:', error.message);
  }
};

// Errors from HTTP clients may retain passwords or OAuth tokens in config.data.
// Authentication logs only retain a bounded error category and numeric DB code.
export const authErrorSummary = error => ({
  name: ['Error', 'TypeError', 'MongoServerError', 'MongoNetworkError', 'JsonWebTokenError', 'TokenExpiredError'].includes(error?.name) ? error.name : 'Error',
  ...(Number.isInteger(error?.code) ? { code: error.code } : {}),
});
