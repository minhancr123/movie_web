import jwt from 'jsonwebtoken';

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
 * Same as authMiddleware but also accepts `?access_token=`.
 *
 * Needed for media URLs the browser fetches itself (Safari native HLS, and a
 * `<video src>` fallback) where no request header can be attached. Only mounted
 * on the HLS asset route, which re-checks session ownership per request.
 */
export const mediaAuthMiddleware = (req, res, next) => {
  try {
    const token =
      req.headers.authorization?.split(' ')[1] ||
      (typeof req.query.access_token === 'string' ? req.query.access_token : null);

    if (!token) {
      return res.status(401).json({ success: false, message: 'Không có token xác thực' });
    }

    req.user = jwt.verify(token, process.env.JWT_SECRET);
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
