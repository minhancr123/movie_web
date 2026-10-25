/** Process-local scheduling; only the playback process creates FFmpeg writers. */
export const queueError = (code, message, status = 503) => Object.assign(new Error(message), { code, status });
export const abortedResolve = () => queueError('RESOLVE_SUPERSEDED', 'Yêu cầu phát đã được thay thế', 499);

export function createAdmissionQueue({ tryAcquire, release, intervalMs = 250, maxPending = 128,
  maxWaitMs = 10 * 60_000, now = Date.now, agingMs = 30_000 } = {}) {
  let pending = [], timer, pumping = false, serial = 0;
  const cleanup = entry => entry.signal?.removeEventListener('abort', entry.abort);
  const finish = (entry, error, value) => {
    pending = pending.filter(item => item !== entry); cleanup(entry);
    if (error) entry.reject(error); else entry.resolve(value);
  };
  const publish = () => {
    pending.sort((a,b) => (a.priority - Math.floor((now()-a.at)/agingMs))
      - (b.priority - Math.floor((now()-b.at)/agingMs)) || a.serial-b.serial);
    pending.forEach((entry, i) => {
      const label = `${i+1}/${pending.length}`;
      if (entry.waiting && entry.label !== label) {
        entry.label = label;
        try { entry.onWait?.({ position:i+1, total:pending.length }); } catch { /* display only */ }
      }
    });
    if (!pending.length && timer) { clearInterval(timer); timer = undefined; }
  };
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      for (const entry of [...pending]) {
        if (entry.signal?.aborted) finish(entry, abortedResolve());
        else if (now()-entry.at >= maxWaitMs) finish(entry, queueError('REMUX_QUEUE_TIMEOUT', 'Hết thời gian chờ lượt phát. Vui lòng thử lại.'));
      }
      publish();
      while (pending.length) {
        const entry = pending[0];
        let result;
        try { result = await tryAcquire(entry.options); }
        catch (error) { finish(entry, error); publish(); continue; }
        // Cancellation may have removed this entry while admission awaited.
        if (!pending.includes(entry) || entry.signal?.aborted) {
          if (result?.admitted) release(result.reservationId);
          if (pending.includes(entry)) finish(entry, abortedResolve());
          publish(); continue;
        }
        if (!result?.admitted) {
          pending.forEach(item => { item.waiting = true; }); publish(); break;
        }
        finish(entry, null, result); publish();
      }
    } finally { pumping = false; }
  };
  return {
    acquire(options = {}, { signal, priority = 1, onWait } = {}) {
      if (signal?.aborted) return Promise.reject(abortedResolve());
      if (pending.length >= maxPending) return Promise.reject(queueError('REMUX_QUEUE_FULL', 'Hàng chờ đang đầy, vui lòng thử lại sau.'));
      return new Promise((resolve,reject) => {
        const entry = { options, signal, priority:Math.max(0,Math.min(2,Number(priority)||0)), onWait,
          resolve,reject,at:now(),serial:serial++ };
        entry.abort = () => { finish(entry, abortedResolve()); publish(); void pump(); };
        signal?.addEventListener('abort', entry.abort, { once:true });
        pending.push(entry);
        if (!timer) { timer = setInterval(() => { void pump(); }, intervalMs); timer.unref?.(); }
        void pump();
      });
    },
    pump,
    get size() { return pending.length; },
    close() { for (const entry of [...pending]) finish(entry, abortedResolve()); publish(); },
  };
}

/** A leader keeps the key until its reusable session row is visible in DB.
 * Followers then re-check adoption with their own user/session authorization. */
export function createRenditionGate() {
  const owners = new Map();
  return {
    acquire(key, { signal, onWait } = {}) {
      if (signal?.aborted) return Promise.reject(abortedResolve());
      return new Promise((resolve,reject) => {
        const entry = { resolve,reject,signal };
        const grant = () => {
          signal?.removeEventListener('abort', entry.abort);
          let released = false;
          resolve(() => {
            if (released) return; released = true;
            const next = owners.get(key)?.shift();
            if (next) next.grant(); else owners.delete(key);
          });
        };
        entry.grant = grant;
        entry.abort = () => {
          const queue = owners.get(key);
          if (queue) owners.set(key, queue.filter(item => item !== entry));
          signal?.removeEventListener('abort', entry.abort); reject(abortedResolve());
        };
        if (owners.has(key)) {
          owners.get(key).push(entry);
          signal?.addEventListener('abort', entry.abort, { once:true });
          try { onWait?.(); } catch { /* display only */ }
        } else { owners.set(key, []); grant(); }
      });
    },
    get size() { return owners.size; },
  };
}
