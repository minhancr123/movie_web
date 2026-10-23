/**
 * Graceful shutdown coordinator.
 * SIGTERM/SIGINT triggers: stop accepting → drain jobs → close media → close stores → exit.
 * Idempotent: calling shutdown() twice only runs the sequence once.
 */

/**
 * @param {Object} opts
 * @param {() => Promise<void>} opts.stopAccepting - Stop HTTP server and Socket.IO from accepting new connections
 * @param {() => Promise<void>} opts.closeJobs - Close BullMQ workers/schedulers, drain in-flight jobs
 * @param {() => Promise<void>} opts.closeMedia - Stop active remux/transcode writers (stopAllRemux)
 * @param {() => Promise<void>} opts.closeStores - Quit Redis and close MongoDB connections
 * @param {number} [opts.deadlineMs=30000] - Maximum time for the entire shutdown sequence
 * @returns {(signal?: string) => Promise<void>} Idempotent shutdown function
 */
export function createShutdown({ stopAccepting, closeJobs, closeMedia, closeStores, deadlineMs = 30000, exitProcess = false }) {
  let shutdownPromise = null;

  return function shutdown(signal) {
    if (shutdownPromise) return shutdownPromise;

    let deadlineTimer;
    const deadline = new Promise((_, reject) => {
      deadlineTimer = setTimeout(() => reject(new Error(`shutdown deadline exceeded after ${deadlineMs}ms`)), deadlineMs);
      // Don't keep the process alive just for the deadline timer
      if (deadlineTimer.unref) deadlineTimer.unref();
    });

    shutdownPromise = Promise.race([
      (async () => {
        console.log(`[lifecycle] shutdown initiated by ${signal || 'unknown'}, draining…`);
        await stopAccepting();
        await closeJobs();
        await closeMedia();
        await closeStores();
        console.log('[lifecycle] shutdown complete');
      })(),
      deadline,
    ]).then(() => {
      clearTimeout(deadlineTimer);
      // The sequence depends on the event loop emptying on its own after the
      // stores close, but one leftover handle — an untracked ffmpeg child a
      // mid-flight resolve spawned, a straggler timer — leaves a listener-less
      // zombie that systemd still believes is alive (no restart, port dead).
      // Callers that own the process (server.js) opt into exiting here.
      if (exitProcess) {
        console.log('[lifecycle] exiting');
        process.exit(process.exitCode || 0);
      }
    }, err => {
      clearTimeout(deadlineTimer);
      console.error('[lifecycle] shutdown error or deadline:', err.message);
      process.exitCode = 1;
      if (exitProcess) process.exit(1);
    });

    return shutdownPromise;
  };
}
