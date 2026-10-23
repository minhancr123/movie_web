import promClient from 'prom-client';
import { getResolveTimings, finishResolveStages } from '../playback/resolveProgress.js';
import { writerSlotStatus } from '../playback/remuxService.js';

export const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });
const metric = (Class, options) => new Class({ ...options, registers: [register] });
export const httpDuration = metric(promClient.Histogram, {
  name: 'http_request_duration_seconds', help: 'HTTP request duration; route templates only',
  labelNames: ['method', 'route', 'status_code'], buckets: [0.1, 0.5, 1, 2, 5, 15, 60, 120],
});
export const remuxActiveCount = metric(promClient.Gauge, {
  name: 'remux_active_count', help: 'Active remux writers',
  collect() { this.set(writerSlotStatus().active ?? 0); },
});
export const playbackResolveDuration = metric(promClient.Histogram, {
  name: 'playback_resolve_duration_seconds', help: 'Server resolve duration, not client first frame',
  labelNames: ['status', 'source_type'], buckets: [0.5, 1, 2, 3, 5, 8, 15, 30, 60, 120],
});
// Bump the schema whenever boundaries change; old workers/retained series must
// never be summed into the same quantile as a different bucket layout.
export const LATENCY_SCHEMA = 'latency-v3';
// A bucket can remain nonzero across a restart while its neighbours reset.
// Separate process lifetimes before rate() so these partial resets cannot mix.
export const METRICS_GENERATION = `${Date.now()}:${process.pid}`;
const latencyBuckets = [0.1, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 45, 60, 90, 120, 180, 300];
export const playbackFirstFrame = metric(promClient.Histogram, {
  name: 'playback_time_to_first_frame_seconds', help: 'Client request to first rendered video frame',
  labelNames: ['source_type', 'schema', 'generation'], buckets: latencyBuckets,
});
export const playbackSeekLatency = metric(promClient.Histogram, {
  name: 'playback_seek_latency_seconds', help: 'Client seek intent to rendered frame',
  labelNames: ['method', 'schema', 'generation'], buckets: latencyBuckets,
});
export const playbackSuccessTotal = metric(promClient.Counter, {
  name: 'playback_success_total', help: 'Client playback starts reaching a rendered frame', labelNames: ['source_type'],
});
export const playbackFailureTotal = metric(promClient.Counter, {
  name: 'playback_failure_total', help: 'Failed resolve or client playback', labelNames: ['error_code'],
});
export const playbackStageDuration = metric(promClient.Histogram, {
  name: 'playback_stage_duration_seconds', help: 'Completed server resolve stages',
  labelNames: ['stage'], buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
});
export const playbackPlayedSeconds = metric(promClient.Counter, {
  name: 'playback_played_seconds_total', help: 'Client wall-clock seconds actively playing',
});
export const playbackRebufferSeconds = metric(promClient.Counter, {
  name: 'playback_rebuffer_seconds_total', help: 'Client seconds stalled after first frame; excludes seeking and pausing',
});
for (const mode of ['direct', 'remux', 'downloading', 'other']) {
  playbackSuccessTotal.inc({ source_type: mode }, 0);
  playbackFirstFrame.zero({ source_type: mode, schema: LATENCY_SCHEMA, generation: METRICS_GENERATION });
  playbackSeekLatency.zero({ method: mode, schema: LATENCY_SCHEMA, generation: METRICS_GENERATION });
}
for (const code of ['resolve_error', 'client_media_error']) playbackFailureTotal.inc({ error_code: code }, 0);
const sourceType = mode => ['direct', 'remux', 'downloading'].includes(mode) ? mode : 'other';
const stageNames = new Set(['waiting_writer', 'detail', 'vietsub-lookup', 'yastream', 'vimo', 'sources', 'rank', 'reuse', 'prepare', 'link', 'probe', 'published', 'remux', 'buffer', 'warm', 'ready', 'error']);
export const observePlaybackResolve = (req, res, next) => {
  const started = performance.now();
  let mode = 'other';
  const json = res.json;
  res.json = function(body) { mode = sourceType(body?.data?.mode); return json.call(this, body); };
  res.once('finish', () => {
    const status = res.statusCode >= 400 ? 'error' : res.statusCode === 202 ? 'pending' : 'success';
    playbackResolveDuration.observe({ status, source_type: mode }, Math.max(0, performance.now() - started) / 1000);
    if (status === 'error') playbackFailureTotal.inc({ error_code: 'resolve_error' });
    if (finishResolveStages(req.body?.resolveId)) {
      for (const timing of getResolveTimings(req.body.resolveId)?.stages || []) {
        playbackStageDuration.observe({ stage: stageNames.has(timing.stage) ? timing.stage : 'other' }, timing.durationMs / 1000);
      }
    }
  });
  next();
};
export const observeHttp = (req, res, next) => {
  const started = performance.now();
  res.once('finish', () => httpDuration.observe({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(req.method) ? req.method : 'OTHER',
    route: req.route?.path || 'unmatched', status_code: String(res.statusCode),
  }, Math.max(0, performance.now() - started) / 1000));
  next();
};
export function metricsMiddleware(app) {
  app.get('/metrics', async (req, res, next) => {
    // req.ip honors only the configured trusted proxy hop. Public Nginx also
    // blocks this path; Prometheus on the host scrapes loopback directly.
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip)) return res.sendStatus(404);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', register.contentType);
    try { res.end(await register.metrics()); } catch (error) { next(error); }
  });
}
export const recordPlaybackEvent = (session, event) => {
  const mode = sourceType(session.mode);
  if (event.type === 'first_frame') {
    playbackFirstFrame.observe({ source_type: mode, schema: LATENCY_SCHEMA, generation: METRICS_GENERATION }, event.seconds);
    playbackSuccessTotal.inc({ source_type: mode });
  } else if (event.type === 'seek') playbackSeekLatency.observe({ method: mode, schema: LATENCY_SCHEMA, generation: METRICS_GENERATION }, event.seconds);
  else if (event.type === 'summary') {
    playbackPlayedSeconds.inc(event.playedSeconds);
    playbackRebufferSeconds.inc(event.stalledSeconds);
  } else if (event.type === 'error') playbackFailureTotal.inc({ error_code: 'client_media_error' });
};
