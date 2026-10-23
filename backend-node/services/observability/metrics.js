import promClient from 'prom-client';

const Registry = promClient.Registry;
const register = new Registry();

promClient.collectDefaultMetrics({ register });

export const httpDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5],
});
register.registerMetric(httpDuration);

export const queueDepth = new promClient.Gauge({
  name: 'job_queue_depth',
  help: 'Number of jobs currently in the queue',
});
register.registerMetric(queueDepth);

export const remuxActiveCount = new promClient.Gauge({
  name: 'remux_active_count',
  help: 'Number of active remux processes',
});
register.registerMetric(remuxActiveCount);

// --- Playback observability metrics ---

export const playbackResolveDuration = new promClient.Histogram({
  name: 'playback_resolve_duration_seconds',
  help: 'Duration of playback resolve in seconds',
  labelNames: ['status', 'source_type'],
  buckets: [1, 2, 5, 10, 30, 60, 120],
});
register.registerMetric(playbackResolveDuration);

export const playbackSeekLatency = new promClient.Histogram({
  name: 'playback_seek_latency_seconds',
  help: 'Latency of seek operations in seconds',
  labelNames: ['method'], // 'direct' | 'remux' | 'hls_fallback'
  buckets: [0.5, 1, 2, 4, 8, 15, 30],
});
register.registerMetric(playbackSeekLatency);

export const playbackSuccessTotal = new promClient.Counter({
  name: 'playback_success_total',
  help: 'Total successful playback sessions',
  labelNames: ['source_type'],
});
register.registerMetric(playbackSuccessTotal);

export const playbackFailureTotal = new promClient.Counter({
  name: 'playback_failure_total',
  help: 'Total failed playback sessions',
  labelNames: ['error_code'],
});
register.registerMetric(playbackFailureTotal);

export const playbackStageDuration = new promClient.Histogram({
  name: 'playback_stage_duration_seconds',
  help: 'Duration of individual resolve stages in seconds',
  labelNames: ['stage'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});
register.registerMetric(playbackStageDuration);

export const playbackRebufferRatio = new promClient.Gauge({
  name: 'playback_rebuffer_ratio',
  help: 'Current rebuffer ratio across active sessions',
});
register.registerMetric(playbackRebufferRatio);

export function metricsMiddleware(app) {
  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (ex) {
      res.status(500).end(ex);
    }
  });
}

export { register };
