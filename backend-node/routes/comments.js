import express from 'express';
import { addComment, getComments, deleteComment, updateComment } from '../controllers/commentController.js';
import { authMiddleware, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// Public routes (can view comments without login)
router.get('/:movieSlug', optionalAuth, getComments);

// Protected routes (must login to comment)
router.post('/', authMiddleware, addComment);
router.delete('/:commentId', authMiddleware, deleteComment);
router.put('/:commentId', authMiddleware, updateComment);

export default router;
