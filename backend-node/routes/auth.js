import express from 'express';
import { rateLimit } from '../middleware/rateLimit.js';
import { register, login, getMe, googleLogin, registerValidation, loginValidation, updateProfile } from '../controllers/authController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();
const authRateLimit = rateLimit({ max: 30, windowMs: 60000, keyPrefix: 'rl:auth' });

// Public routes
router.post('/register', authRateLimit, registerValidation, register);
router.post('/login', authRateLimit, loginValidation, login);
router.post('/google-login', authRateLimit, googleLogin);

// Protected routes
router.get('/me', authMiddleware, getMe);
router.put('/profile', authMiddleware, updateProfile);

export default router;
