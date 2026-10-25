import { createResolveJobs } from '../services/playback/resolveJobs.js';
import { getResolveStage as readResolveStage, touchResolveStage } from '../services/playback/resolveProgress.js';
import express from 'express';
import { observePlaybackResolve } from '../services/observability/metrics.js';
import { googleCodeExchange } from '../controllers/authController.js';
import { playbackTelemetry } from '../controllers/playbackTelemetryController.js';
import { getPlaybackTimeline, getPlaybackThumbnail } from '../controllers/playbackExtrasController.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  resolvePlayback,
  prewarmPlayback,
  preloadPlayback,
  listPlaybackSources,
  getResolveStage,
  getPlaybackSession,
  heartbeatPlaybackSession,
  leavePlaybackSession,
  refreshPlaybackUrl,
  serveHlsAsset,
  serveRenditionAsset,
  getPlaybackSubtitles,
  getSubtitleJob,
  serveSubtitleVtt,
  uploadSubtitle,
} from '../controllers/playbackController.js';
import { authMiddleware, mediaAuthMiddleware } from '../middleware/auth.js';
import {
  playbackRateLimit,
  playbackPollRateLimit,
  playbackPresenceRateLimit,
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
router.get('/hls/r/:renditionId/:asset', (req, res, next) => {
  // Shared immutable segments are public; manifests still authorize the viewer.
  if (req.params.asset.endsWith('.m3u8')) return mediaAuthMiddleware(req, res, next);
  return next();
}, hlsAssetRateLimit, serveRenditionAsset);
// Extracted WebVTT sidecars use the same token-capability pattern: the URL
// itself is unguessable and server-mapped, so no session needed.
router.get('/subtitles/vtt/:token', hlsAssetRateLimit, serveSubtitleVtt);

router.post('/google-exchange', rateLimit({ max: 30, keyPrefix: 'rl:google-exchange' }), googleCodeExchange);

router.use(authMiddleware);

router.get('/session/:sessionId/timeline', playbackPollRateLimit, getPlaybackTimeline);
router.get('/session/:sessionId/thumbnail', rateLimit({ max: 45, keyPrefix: 'rl:seek-thumbnail' }), getPlaybackThumbnail);

const resolveJobs = createResolveJobs({ handler: resolvePlayback, observe: observePlaybackResolve, readStage: readResolveStage, touchStage: touchResolveStage });
const resolveJobLimit = rateLimit({ max: 120, keyPrefix: 'rl:resolve-job' });
router.post('/resolve', playbackRateLimit, (req, res, next) => {
  // Tabs running an older frontend keep the original synchronous contract.
  if (req.body?.asyncQueue !== true) {
    return observePlaybackResolve(req, res, () => { void resolvePlayback(req, res).catch(next); });
  }
  return resolveJobs.start(req, res).catch(next);
});
router.get('/resolve-jobs/:jobId', resolveJobLimit, resolveJobs.poll);
router.delete('/resolve-jobs/:jobId', resolveJobLimit, resolveJobs.cancel);
router.post('/session/:sessionId/telemetry', rateLimit({ max: 30, keyPrefix: 'rl:telemetry' }), playbackTelemetry);
router.post('/prewarm', playbackRateLimit, prewarmPlayback);
router.post('/preload', playbackRateLimit, preloadPlayback);
router.post('/sources', playbackRateLimit, listPlaybackSources);
router.post('/subtitles', playbackRateLimit, getPlaybackSubtitles);
router.get('/subtitles/job/:jobId', playbackPollRateLimit, getSubtitleJob);
// Viewer-uploaded .srt: JSON body (no multipart dependency), so this route
// carries its own 3MB limit instead of raising the global 100kb one.
router.post(
  '/subtitles/upload',
  express.json({ limit: '3mb' }),
  playbackRateLimit,
  uploadSubtitle,
);
router.get('/session/:sessionId', playbackPollRateLimit, getPlaybackSession);
// Explicit viewer presence: heartbeat refreshes the lease (25s cadence),
// leave drops it (unmount/title-change/pagehide via keepalive fetch).
router.post('/session/:sessionId/heartbeat', playbackPresenceRateLimit, heartbeatPlaybackSession);
router.post('/session/:sessionId/leave', playbackPresenceRateLimit, leavePlaybackSession);
// Re-mint an expiring direct-playback URL without a full re-resolve. Mounted
// beside heartbeat/leave: same presence-rate-limit class, same ownership
// check, same session lease it keeps alive.
router.post('/session/:sessionId/refresh', playbackPresenceRateLimit, refreshPlaybackUrl);
router.get('/resolve/:resolveId/stage', playbackPollRateLimit, getResolveStage);

export default router;
