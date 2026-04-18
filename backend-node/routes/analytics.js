import express from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { getViewCount, trackEventAsync, trackViewAsync } from '../controllers/analyticsController.js';

const router = express.Router();

router.post('/view', optionalAuth, trackViewAsync);
router.get('/views/:movieSlug', getViewCount);
router.post('/event', optionalAuth, trackEventAsync);

export default router;
