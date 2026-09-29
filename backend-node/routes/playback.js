import express from 'express';
import {
  resolvePlayback,
  prewarmPlayback,
  preloadPlayback,
  listPlaybackSources,
  getResolveStage,
  getPlaybackSession,
  serveHlsAsset,
  serveRenditionAsset,
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
// the controller on every single request. Native players fetch index.m3u8 once
// with ?access_token= (or a Bearer header on MSE) and then follow the
// ?media_grant= child URLs the server rewrites into the manifest response.
// Manifests are private,no-store; only immutable segments may be edge-cached
// (with the media_grant query ignored in the cache key).
router.get('/hls/:sessionId/:asset', mediaAuthMiddleware, hlsAssetRateLimit, serveHlsAsset);
// Stable cross-viewer URLs for published (finished, immutable) renditions.
// Different segment count than the session route, so no pattern conflict.
// Same media guard; bytes are identical for every logged-in viewer, which is
// what makes edge sharing correct. CDN: never cache index.m3u8
// (private,no-store with per-viewer grants); segments may be cached with the
// media_grant query ignored in the cache key.
router.get('/hls/r/:renditionId/:asset', mediaAuthMiddleware, hlsAssetRateLimit, serveRenditionAsset);
// Extracted WebVTT sidecars use the same token-capability pattern: the URL
// itself is unguessable and server-mapped, so no session needed.
router.get('/subtitles/vtt/:token', hlsAssetRateLimit, serveSubtitleVtt);

router.use(authMiddleware);

router.post('/resolve', playbackRateLimit, resolvePlayback);
router.post('/prewarm', playbackRateLimit, prewarmPlayback);
router.post('/preload', playbackRateLimit, preloadPlayback);
router.post('/sources', playbackRateLimit, listPlaybackSources);
router.post('/subtitles', playbackRateLimit, getPlaybackSubtitles);
router.get('/subtitles/job/:jobId', playbackPollRateLimit, getSubtitleJob);
router.get('/session/:sessionId', playbackPollRateLimit, getPlaybackSession);
router.get('/resolve/:resolveId/stage', playbackPollRateLimit, getResolveStage);

export default router;
