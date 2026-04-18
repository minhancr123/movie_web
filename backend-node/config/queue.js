import IORedis from 'ioredis';
import { Queue } from 'bullmq';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const queueConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
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
  CATALOG_REFRESH: 'catalog.refresh',
  SEARCH_REINDEX_MOVIE: 'search.reindex.movie',
};

export const enqueueJob = async (name, payload = {}, options = {}) => {
  return jobQueue.add(name, payload, options);
};
