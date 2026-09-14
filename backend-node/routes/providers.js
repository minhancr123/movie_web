import express from 'express';
import {
  connectProvider,
  disconnectProvider,
  getProviderStatus,
} from '../controllers/providerController.js';
import { authMiddleware } from '../middleware/auth.js';
import { connectionsRateLimit } from '../middleware/rateLimit.js';

const router = express.Router();

router.use(authMiddleware, connectionsRateLimit);

// Status for every provider (currently just torbox).
router.get('/status', getProviderStatus);
router.get('/:provider/status', getProviderStatus);
router.post('/:provider/connect', connectProvider);
router.post('/:provider/disconnect', disconnectProvider);

export default router;
