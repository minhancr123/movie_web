import { getDB } from '../config/database.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { ObjectId } from 'mongodb';

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
      email,
      username,
      password: hashedPassword,
      fullName: fullName || username,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=dc2626&color=fff`,
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('users').insertOne(newUser);

    // Generate JWT
    const token = jwt.sign(
      {
        userId: result.insertedId,
        email,
        username,
        role: newUser.role
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

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
    console.error('Register error:', error);
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
      return res.status(401).json({
        success: false,
        message: 'Email hoặc mật khẩu không đúng'
      });
    }

    // Generate JWT
    const token = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        username: user.username,
        role: user.role || 'user'
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

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
    console.error('Login error:', error);
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
    console.error('Get me error:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server'
    });
  }
};

// Google Login
export const googleLogin = async (req, res) => {
  try {
    const { email, name, avatar, googleId } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email là bắt buộc'
      });
    }

    const db = getDB();

    // Check if user exists
    let user = await db.collection('users').findOne({ email });
    let isNewUser = false;

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
    const token = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        username: user.username
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.json({
      success: true,
      message: isNewUser ? 'Đăng ký bằng Google thành công' : 'Đăng nhập bằng Google thành công',
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
        avatar: user.avatar
      }
    });

  } catch (error) {
    console.error('Google login error:', error);
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
    console.error('Update profile error:', error);
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
    console.error('Error creating default admin:', error);
  }
};

