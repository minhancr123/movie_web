import jwt from 'jsonwebtoken';
import { MEDIA_GRANT_QUERY, verifyMediaGrant } from '../services/playback/mediaGrant.js';

export const authMiddleware = (req, res, next) => {
  try {
    // Get token from header
    const token = req.headers.authorization?.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Không có token xác thực'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Scoped media grants are segment/movie bearers, never account identity:
    // they must not open any account API even if a deployment reuses one
    // signing key for both token kinds.
    if (decoded?.pur === 'media') {
      return res.status(401).json({
        success: false,
        message: 'Token không hợp lệ hoặc đã hết hạn'
      });
    }
    req.user = decoded; // { userId, email, username, role }
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Token không hợp lệ hoặc đã hết hạn'
    });
  }
};

/**
 * Same as authMiddleware but also accepts `?access_token=` and `?media_grant=`.
 *
 * Needed for media URLs the browser fetches itself (Safari native HLS, and a
 * `<video src>` fallback) where no request header can be attached. Only mounted
 * on the HLS asset routes, which re-check session existence/expiry (and, for
 * user-JWT requests, session ownership) per request.
 *
 * Grant path (preferred for child assets): `?media_grant=` is a short-lived,
 * single-purpose bearer scoped to the session/rendition in the URL
 * (see services/playback/mediaGrant.js). It is GET/HEAD-only and never usable
 * as an account token. The scope expectation comes from the URL itself, so a
 * grant minted for session A cannot open session B or any rendition URL.
 */
export const mediaAuthMiddleware = (req, res, next) => {
  try {
    const grant = typeof req.query?.[MEDIA_GRANT_QUERY] === 'string'
      ? req.query[MEDIA_GRANT_QUERY]
      : null;
    if (grant) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(401).json({ success: false, message: 'Token không hợp lệ hoặc đã hết hạn' });
      }
      const expectSessionId = req.params?.sessionId ? String(req.params.sessionId) : null;
      const expectRenditionId = req.params?.renditionId ? String(req.params.renditionId) : null;
      const checked = verifyMediaGrant(grant, { expectSessionId, expectRenditionId });
      if (!checked.ok) {
        const status = checked.reason === 'scope-mismatch' ? 403 : 401;
        return res.status(status).json({
          success: false,
          message: checked.reason === 'scope-mismatch'
            ? 'Không có quyền truy cập tài nguyên này'
            : 'Token không hợp lệ hoặc đã hết hạn',
        });
      }
      req.mediaGrant = checked;
      req.mediaGrantToken = grant;
      return next();
    }

    const token =
      req.headers.authorization?.split(' ')[1] ||
      (typeof req.query.access_token === 'string' ? req.query.access_token : null);

    if (!token) {
      return res.status(401).json({ success: false, message: 'Không có token xác thực' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // A media grant replayed as ?access_token= must fall through to the grant
    // path above (with its scope check), never pass as user identity.
    if (decoded?.pur === 'media') {
      return res.status(401).json({
        success: false,
        message: 'Token không hợp lệ hoặc đã hết hạn',
      });
    }
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: 'Token không hợp lệ hoặc đã hết hạn',
    });
  }
};

export const optionalAuth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    }
    next();
  } catch (error) {
    // If token is invalid, just continue without user
    next();
  }
};

export const adminMiddleware = [
  authMiddleware,
  (req, res, next) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Quyền truy cập bị từ chối: Yêu cầu quyền admin'
      });
    }
    next();
  }
];
