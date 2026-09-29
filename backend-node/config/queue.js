import IORedis from 'ioredis';
import { Queue } from 'bullmq';

// BullMQ REQUIRES maxmemory-policy noeviction on its instance (see
// docs.bullmq.io/guide/going-to-production): evicted job keys corrupt
// streams. That instance therefore carries queue data ONLY — catalog cache
// lives on REDIS_CACHE_URL (config/redis.js). REDIS_QUEUE_URL wins;
// REDIS_URL remains as the single-instance fallback for dev/tests.
const redisUrl =
  process.env.REDIS_QUEUE_URL ||
  process.env.REDIS_URL ||
  `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`;

export const queueConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  maxLoadingRetryTime: 5000,
  retryStrategy(times) {
    if (times > 5) return null;
    return Math.min(times * 1000, 3000);
  },
});

let warned = false;
queueConnection.on('error', (error) => {
  // Without this listener an unreachable Redis crashes the process with an
  // unhandled 'error' event (startup races the container, tests have no
  // server at all). Log once; BullMQ retries per retryStrategy above.
  if (!warned) {
    console.error('[queue] Redis error:', error?.message || error);
    warned = true;
  }
});

const queueName = process.env.JOB_QUEUE_NAME || 'movieweb-jobs';

export const jobQueue = new Queue(queueName, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    removeOnComplete: 500,
    removeOnFail: 1000,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

export const JOBS = {
  VIEW_INCREMENT: 'view.increment',
  FAVORITE_SYNC: 'favorite.sync',
  WATCH_HISTORY_SYNC: 'watch-history.sync',
  PREMIERE_NOTIFY_SEND: 'premiere.notify.send',
  ANALYTICS_TRACK: 'analytics.track',
};

export const enqueueJob = async (name, payload = {}, options = {}) => {
  return jobQueue.add(name, payload, options);
};
