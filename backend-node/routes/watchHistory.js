import express from 'express';
import { addWatchHistory, getWatchHistory, deleteWatchHistory, clearWatchHistory } from '../controllers/watchHistoryController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// All routes are protected
router.use(authMiddleware);

router.post('/', addWatchHistory);
router.get('/', getWatchHistory);
router.delete('/:movieSlug', deleteWatchHistory);
router.delete('/', clearWatchHistory);

export default router;
