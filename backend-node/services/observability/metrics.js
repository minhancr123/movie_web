import promClient from 'prom-client';

const Registry = promClient.Registry;
const register = new Registry();

promClient.collectDefaultMetrics({ register });

export const httpDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5]
});
register.registerMetric(httpDuration);

export const queueDepth = new promClient.Gauge({
  name: 'job_queue_depth',
  help: 'Number of jobs currently in the queue'
});
register.registerMetric(queueDepth);

export const remuxActiveCount = new promClient.Gauge({
  name: 'remux_active_count',
  help: 'Number of active remux processes'
});
register.registerMetric(remuxActiveCount);

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
