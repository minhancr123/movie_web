import express from 'express';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import {
  createRequest,
  getRequests,
  getMyRequests,
  updateRequestStatus
} from '../controllers/movieRequestController.js';

const router = express.Router();

/**
 * @route   GET /api/movie-requests
 * @desc    Get all movie requests (Admin only)
 */
router.get('/', adminMiddleware, getRequests);

/**
 * @route   GET /api/movie-requests/me
 * @desc    Get current user's movie requests
 */
router.get('/me', authMiddleware, getMyRequests);

/**
 * @route   POST /api/movie-requests
 * @desc    Create a new movie request
 */
router.post('/', authMiddleware, createRequest);

/**
 * @route   PUT /api/movie-requests/:id
 * @desc    Update movie request status (Admin only)
 */
router.put('/:id', adminMiddleware, updateRequestStatus);

export default router;
