import dotenv from 'dotenv';
import cron from 'node-cron';
import { connectDB, getDB } from '../config/database.js';
import { enqueueJob, JOBS } from '../config/queue.js';

dotenv.config();

const run = async () => {
  await connectDB();

  // Refresh catalog + ES index every hour.
  cron.schedule('0 * * * *', async () => {
    try {
      await enqueueJob(JOBS.CATALOG_REFRESH, { pages: Number(process.env.CATALOG_REFRESH_PAGES || 3) });
      console.log('[scheduler] queued catalog refresh');
    } catch (error) {
      console.error('[scheduler] catalog refresh enqueue error:', error.message);
    }
  });

  // Every minute, schedule reminder notifications for events starting in the next 10 minutes.
  cron.schedule('*/1 * * * *', async () => {
    try {
      const db = getDB();
      const now = new Date();
      const tenMinutesLater = new Date(now.getTime() + 10 * 60 * 1000);

      const events = await db.collection('premiere_events').find({
        status: 'scheduled',
        startTime: { $gte: now, $lte: tenMinutesLater },
      }).project({ _id: 1 }).toArray();

      for (const event of events) {
        await enqueueJob(
          JOBS.PREMIERE_NOTIFY_SEND,
          { eventId: String(event._id) },
          { jobId: `premiere-notify-${event._id}-${now.toISOString().slice(0, 16)}` }
        );
      }

      if (events.length) {
        console.log(`[scheduler] queued ${events.length} premiere notify jobs`);
      }
    } catch (error) {
      console.error('[scheduler] premiere notify enqueue error:', error.message);
    }
  });

  console.log('[scheduler] started');
};

run().catch((err) => {
  console.error('[scheduler] startup error:', err);
  process.exit(1);
});
