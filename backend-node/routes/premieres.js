import express from 'express';
import { 
  createPremiereEvent, 
  getPremiereEvents, 
  getUpcomingPremieres,
  getPremiereBySlug,
  updateEventStatus,
  deletePremiereEvent,
  registerForNotification
} from '../controllers/premiereController.js';
import { authMiddleware, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.get('/', getPremiereEvents);
router.get('/upcoming', getUpcomingPremieres);
router.get('/movie/:movieSlug', getPremiereBySlug);

// Protected routes
router.post('/', authMiddleware, createPremiereEvent);
router.put('/:eventId/status', authMiddleware, updateEventStatus);
router.delete('/:eventId', authMiddleware, deletePremiereEvent);
router.post('/:eventId/notify', authMiddleware, registerForNotification);

export default router;
