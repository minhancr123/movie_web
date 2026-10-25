type JobResponse = { status: number; data: any };
const cancelled = () => Object.assign(new Error('Đã hủy yêu cầu phát'), { name:'CanceledError', code:'ERR_CANCELED' });
const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve,reject) => {
  if (signal?.aborted) { reject(cancelled()); return; }
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort',abort); reject(cancelled()); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort',abort); resolve(); },ms);
  signal?.addEventListener('abort',abort,{once:true});
});

/** Keep one resolve intent alive while the server queues it. No repeated
 * TorBox/probe requests and no long-running HTTP connection through the proxy. */
export async function completeResolveRequest<T extends JobResponse>(request: () => Promise<T>, options: {
  poll: (id: string, signal?: AbortSignal) => Promise<T>;
  cancel: (id: string) => Promise<unknown>;
  signal?: AbortSignal; intervalMs?: number; maxWaitMs?: number;
}): Promise<T> {
  let id: string | undefined, active = false, cancellationSent = false, pollFailures = 0;
  const abort = () => {
    if (id && active && !cancellationSent) { cancellationSent = true; void options.cancel(id).catch(() => {}); }
  };
  options.signal?.addEventListener('abort',abort,{once:true});
  const started = Date.now();
  try {
    if (options.signal?.aborted) throw cancelled();
    let response = await request();
    while (response.status === 202 && response.data?.data?.mode === 'resolve_pending') {
      const nextId = response.data.data.jobId;
      if (typeof nextId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(nextId) || (id && nextId !== id)) {
        throw new Error('Mã yêu cầu chờ không hợp lệ. Vui lòng mở lại phim.');
      }
      id = nextId; active = true;
      if (options.signal?.aborted) { abort(); throw cancelled(); }
      if (Date.now()-started >= (options.maxWaitMs ?? 15*60_000)) {
        abort(); throw new Error('Hết thời gian chờ lượt phát. Vui lòng thử lại.');
      }
      await delay(options.intervalMs ?? 1500,options.signal);
      try { response = await options.poll(id,options.signal); pollFailures = 0; }
      catch (error) {
        const status = (error as {response?: {status?: number}})?.response?.status;
        if (options.signal?.aborted || (status && status >= 400 && status < 500 && status !== 429) || ++pollFailures >= 3) throw error;
      }
    }
    active = false;
    return response;
  } finally {
    // A network/poll error also abandons the queued work, rather than leaving
    // it to consume a writer after the UI has already failed or switched.
    if (active) abort();
    options.signal?.removeEventListener('abort',abort);
  }
}
