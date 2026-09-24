import dotenv from 'dotenv';
import { Worker } from 'bullmq';
import { ObjectId } from 'mongodb';

import { connectDB, getDB } from '../config/database.js';
import { queueConnection, JOBS } from '../config/queue.js';

dotenv.config();

const queueName = process.env.JOB_QUEUE_NAME || 'movieweb-jobs';

const handlers = {
  [JOBS.VIEW_INCREMENT]: async (data) => {
    const db = getDB();
    await db.collection('movie_stats').updateOne(
      { movieSlug: data.movieSlug },
      {
        $inc: { views: 1 },
        $set: { updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );

    await db.collection('analytics_events').insertOne({
      type: 'view.increment',
      movieSlug: data.movieSlug,
      userId: data.userId ? new ObjectId(data.userId) : null,
      currentTime: Number(data.currentTime || 0),
      source: data.source || 'web',
      userAgent: data.userAgent || '',
      ip: String(data.ip || ''),
      occurredAt: new Date(data.occurredAt || Date.now()),
      createdAt: new Date(),
    });
  },

  [JOBS.FAVORITE_SYNC]: async (data) => {
    const db = getDB();
    await db.collection('favorite_sync_events').insertOne({
      ...data,
      userId: data.userId ? new ObjectId(data.userId) : null,
      createdAt: new Date(),
    });
  },

  [JOBS.WATCH_HISTORY_SYNC]: async (data) => {
    const db = getDB();
    await db.collection('watch_history_sync_events').insertOne({
      ...data,
      userId: data.userId ? new ObjectId(data.userId) : null,
      createdAt: new Date(),
    });
  },

  [JOBS.PREMIERE_NOTIFY_SEND]: async (data) => {
    const db = getDB();
    const eventId = new ObjectId(data.eventId);
    const event = await db.collection('premiere_events').findOne({ _id: eventId });
    if (!event) return;

    const userIds = (event.notifiedUsers || []).map((id) => new ObjectId(id));
    if (!userIds.length) return;

    const now = new Date();
    const docs = userIds.map((userId) => ({
      userId,
      type: 'premiere_reminder',
      title: `Sắp công chiếu: ${event.name}`,
      body: 'Phim bạn theo dõi sắp bắt đầu. Vào phòng chiếu ngay nhé!',
      eventId,
      movieSlug: event.movieSlug,
      createdAt: now,
      read: false,
    }));

    await db.collection('notifications').insertMany(docs);
  },

  [JOBS.ANALYTICS_TRACK]: async (data) => {
    const db = getDB();
    await db.collection('analytics_events').insertOne({
      type: data.type,
      payload: data.payload || {},
      userId: data.userId ? new ObjectId(data.userId) : null,
      userAgent: data.userAgent || '',
      ip: String(data.ip || ''),
      occurredAt: new Date(data.occurredAt || Date.now()),
      createdAt: new Date(),
    });
  },


};

import { startHeartbeat } from '../services/health/heartbeat.js';
import { createShutdown } from '../services/health/lifecycle.js';
import dbClient from '../config/database.js';

const start = async () => {
  await connectDB();


  const worker = new Worker(
    queueName,
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) {
        console.warn(`[worker] No handler for job: ${job.name}`);
        return;
      }
      await handler(job.data);
    },
    {
      connection: queueConnection,
      concurrency: Number(process.env.WORKER_CONCURRENCY || 10),
    }
  );

  worker.on('completed', (job) => {
    console.log(`[worker] completed: ${job.name} #${job.id}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[worker] failed: ${job?.name} #${job?.id}`, err?.message);
  });

  console.log(`[worker] started on queue: ${queueName}`);

  let stopHeartbeat = null;
  if (process.env.RELEASE_ID) {
    stopHeartbeat = startHeartbeat({
      redis: queueConnection,
      service: 'worker',
      releaseId: process.env.RELEASE_ID
    });
  }

  const shutdown = createShutdown({
    stopAccepting: async () => {},
    closeJobs: async () => {
      await worker.close();
      if (stopHeartbeat) stopHeartbeat();
    },
    closeMedia: async () => {},
    closeStores: async () => {
      await queueConnection.quit();
      await dbClient.close();
    }
  });

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

start().catch((err) => {
  console.error('[worker] startup error:', err);
  process.exit(1);
});
