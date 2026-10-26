import { recordAuthEvent, authErrorSummary } from '../services/security/authAudit.js';
import { getDB } from '../config/database.js';
import bcrypt from 'bcryptjs';
import { signAccountToken } from '../services/security/accountToken.js';
import { body, validationResult } from 'express-validator';
import { ObjectId } from 'mongodb';
import { OAuth2Client } from 'google-auth-library';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Validation rules
export const registerValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Email không hợp lệ'),
  body('username').isLength({ min: 3, max: 20 }).trim().withMessage('Username phải từ 3-20 ký tự'),
  body('password').isLength({ min: 6 }).withMessage('Mật khẩu phải ít nhất 6 ký tự'),
  body('fullName').optional().trim().isLength({ max: 50 })
];

export const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Email không hợp lệ'),
  body('password').notEmpty().withMessage('Mật khẩu không được để trống')
];

// Register
export const register = async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { email, username, password, fullName } = req.body;
    const db = getDB();

    // Check if user exists
    const existingUser = await db.collection('users').findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email hoặc username đã tồn tại'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const newUser = {
      _id: new ObjectId(),
      email,
      username,
      password: hashedPassword,
      fullName: fullName || username,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=dc2626&color=fff`,
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Sign before persisting: an invalid token configuration must not leave
    // an account behind while returning a registration failure.
    const token = signAccountToken(
      {
        userId: newUser._id,
        email,
        username,
        role: newUser.role
      }
    );
    let result;
    try {
      result = await db.collection('users').insertOne(newUser);
    } catch (error) {
      // The pre-check above races between two concurrent registrations; the
      // unique index is the real guard, so translate its verdict instead of
      // surfacing a 500 for a perfectly ordinary double-submit.
      if (error?.code === 11000 || error?.message?.includes('E11000')) {
        return res.status(400).json({
          success: false,
          message: 'Email hoặc username đã tồn tại'
        });
      }
      throw error;
    }

    await recordAuthEvent(req, { user: newUser, provider: 'local', action: 'register' });
    res.status(201).json({
      success: true,
      message: 'Đăng ký thành công',
      token,
      user: {
        id: result.insertedId,
        email,
        username,
        fullName: newUser.fullName,
        avatar: newUser.avatar,
        role: newUser.role
      }
    });
  } catch (error) {
    console.error('Register error:', authErrorSummary(error));
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi đăng ký'
    });
  }
};

// Login
export const login = async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { email, password } = req.body;
    const db = getDB();

    // Find user
    const user = await db.collection('users').findOne({ email });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Email hoặc mật khẩu không đúng'
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      await recordAuthEvent(req, { user, provider: 'local', action: 'login', outcome: 'failure' });
      return res.status(401).json({
        success: false,
        message: 'Email hoặc mật khẩu không đúng'
      });
    }

    if (user.isBanned === true) return res.status(403).json({ success: false, code: 'ACCOUNT_BANNED', message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' });
    // Generate JWT
    const token = signAccountToken(
      {
        userId: user._id,
        email: user.email,
        username: user.username,
        role: user.role || 'user'
      }
    );

    await recordAuthEvent(req, { user, provider: 'local', action: 'login' });
    res.json({
      success: true,
      message: 'Đăng nhập thành công',
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
        avatar: user.avatar,
        role: user.role || 'user'
      }
    });
  } catch (error) {
    console.error('Login error:', authErrorSummary(error));
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi đăng nhập'
    });
  }
};

// Get current user
export const getMe = async (req, res) => {
  try {
    const db = getDB();
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(req.user.userId) },
      { projection: { password: 0 } }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Người dùng không tồn tại'
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get me error:', authErrorSummary(error));
    res.status(500).json({
      success: false,
      message: 'Lỗi server'
    });
  }
};

// Google Login
// POST /api/playback/google-exchange — Safari flow từ app iOS: code → Google
// token endpoint → idToken → googleLogin. iOS client loại installed: không cần secret.
export const googleCodeExchange = async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ success: false, message: "code là bắt buộc" });
    const clientId = String(req.body.clientId || process.env.GOOGLE_CLIENT_ID);
    const redirectUri = String(req.body.redirectUri || "");
    const params = {
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    };
    if (clientId === process.env.GOOGLE_CLIENT_ID) {
      params.client_secret = process.env.GOOGLE_CLIENT_SECRET;
    }
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    const tokens = await tokenRes.json();
    if (!tokens.id_token) {
      return res.status(401).json({ success: false, message: tokens.error_description || tokens.error || "Đổi mã Google thất bại" });
    }
    req.body.idToken = tokens.id_token;
    // Audience comes from the successful server-side code exchange, never
    // directly from an arbitrary idToken login request body.
    req.googleCodeAudience = clientId;
    return googleLogin(req, res);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Lỗi server" });
  }
};

export const googleLogin = async (req, res) => {
  try {
    const idToken = req.body.idToken || req.body.id_token;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'idToken là bắt buộc'
      });
    }

    let payload;
    try {
      const audience = req.googleCodeAudience || process.env.GOOGLE_CLIENT_ID;
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience,
      });
      payload = ticket.getPayload();
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Token Google không hợp lệ'
      });
    }

    const email = payload.email;
    const name = payload.name || req.body.name;
    const avatar = payload.picture || req.body.avatar;
    const googleId = payload.sub || req.body.googleId;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email không hợp lệ từ Token Google'
      });
    }

    const db = getDB();

    // Check if user exists
    let user = await db.collection('users').findOne({ email });
    let isNewUser = false;
    if (user?.isBanned === true) return res.status(403).json({ success: false, code: 'ACCOUNT_BANNED', message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' });

    if (!user) {
      // Create new user
      isNewUser = true;
      const randomPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(randomPassword, salt);

      // Generate unique username from email
      let username = email.split('@')[0];
      let counter = 1;
      while (await db.collection('users').findOne({ username })) {
        username = `${email.split('@')[0]}${counter}`;
        counter++;
      }

      const newUser = {
        email,
        username,
        password: hashedPassword,
        fullName: name || username,
        avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=dc2626&color=fff`,
        googleId,
        authProvider: 'google',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection('users').insertOne(newUser);
      user = { ...newUser, _id: result.insertedId };
    } else {
      // Update existing user with googleId if not present
      if (!user.googleId) {
        await db.collection('users').updateOne(
          { _id: user._id },
          {
            $set: {
              googleId,
              authProvider: user.authProvider ? user.authProvider : 'local_and_google'
            }
          }
        );
      }
    }

    // Generate JWT
    const token = signAccountToken(
      {
        userId: user._id,
        email: user.email,
        username: user.username,
        role: user.role || 'user'
      }
    );

    await recordAuthEvent(req, { user, provider: 'google', action: isNewUser ? 'register' : 'login' });
    res.json({
      success: true,
      message: isNewUser ? 'Đăng ký bằng Google thành công' : 'Đăng nhập bằng Google thành công',
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
        avatar: user.avatar,
        role: user.role || 'user'
      }
    });

  } catch (error) {
    console.error('Google login error:', authErrorSummary(error));
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi đăng nhập bằng Google'
    });
  }
};
// Update Profile
export const updateProfile = async (req, res) => {
  try {
    const { fullName, avatar, currentPassword, newPassword } = req.body;
    const db = getDB();
    const userId = new ObjectId(req.user.userId);

    const user = await db.collection('users').findOne({ _id: userId });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Người dùng không tồn tại'
      });
    }

    const updates = {};
    if (fullName) updates.fullName = fullName;
    if (avatar) updates.avatar = avatar;

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng nhập mật khẩu hiện tại để thay đổi mật khẩu'
        });
      }

      // Check current password
      // If user has no password (e.g. google login only), they might need to set one. 
      // But usually they should have a password if they are changing it, or we allow setting it if null?
      // For now assume standard flow.
      if (user.password) {
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
          return res.status(400).json({
            success: false,
            message: 'Mật khẩu hiện tại không đúng'
          });
        }
      }

      const salt = await bcrypt.genSalt(10);
      updates.password = await bcrypt.hash(newPassword, salt);
    }

    updates.updatedAt = new Date();

    await db.collection('users').updateOne(
      { _id: userId },
      { $set: updates }
    );

    const updatedUser = await db.collection('users').findOne(
      { _id: userId },
      { projection: { password: 0 } }
    );

    res.json({
      success: true,
      message: 'Cập nhật thông tin thành công',
      user: updatedUser
    });

  } catch (error) {
    console.error('Update profile error:', authErrorSummary(error));
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi cập nhật thông tin'
    });
  }
};

export const createDefaultAdmin = async () => {
  try {
    const db = getDB();
    const adminEmail = 'admin@movieweb.com';
    const existingAdmin = await db.collection('users').findOne({ email: adminEmail });

    if (!existingAdmin) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('123456', salt);

      const adminUser = {
        email: adminEmail,
        username: 'admin',
        password: hashedPassword,
        fullName: 'System Admin',
        avatar: `https://ui-avatars.com/api/?name=Admin&background=dc2626&color=fff`,
        role: 'admin',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await db.collection('users').insertOne(adminUser);
      console.log('Admin account created/verified: admin@movieweb.com');
    }
  } catch (error) {
    console.error('Error creating default admin:', authErrorSummary(error));
  }
};

