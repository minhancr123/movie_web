import express from 'express';
import {
  resolvePlayback,
  listPlaybackSources,
  getPlaybackSession,
  serveHlsAsset,
  getPlaybackSubtitles,
  getSubtitleJob,
  serveSubtitleVtt,
} from '../controllers/playbackController.js';
import { authMiddleware, mediaAuthMiddleware } from '../middleware/auth.js';
import {
  playbackRateLimit,
  playbackPollRateLimit,
  hlsAssetRateLimit,
} from '../middleware/rateLimit.js';

const router = express.Router();

// HLS assets accept a query token because the browser fetches them directly;
// mounted before the header-only guard below. Ownership is still enforced in
// the controller on every single request.
router.get('/hls/:sessionId/:asset', mediaAuthMiddleware, hlsAssetRateLimit, serveHlsAsset);
// Extracted WebVTT sidecars use the same token-capability pattern: the URL
// itself is unguessable and server-mapped, so no session needed.
router.get('/subtitles/vtt/:token', hlsAssetRateLimit, serveSubtitleVtt);

router.use(authMiddleware);

router.post('/resolve', playbackRateLimit, resolvePlayback);
router.post('/sources', playbackRateLimit, listPlaybackSources);
router.post('/subtitles', playbackRateLimit, getPlaybackSubtitles);
router.get('/subtitles/job/:jobId', playbackPollRateLimit, getSubtitleJob);
router.get('/session/:sessionId', playbackPollRateLimit, getPlaybackSession);

export default router;
