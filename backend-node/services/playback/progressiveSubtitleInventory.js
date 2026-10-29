import crypto from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status });
const aborted = () => new DOMException('Subtitle inventory cancelled', 'AbortError');

/** Per-viewer subscriptions. Cancellation never stops a shared media writer or
 * another viewer's extraction; producers only publish while their lease lives. */
export const createSubtitleInventories = ({ external, embedded, now = Date.now,
  maxJobs = 128, maxActive = 32, perUser = 2, timeoutMs = 120000, retentionMs = 300000 } = {}) => {
  const jobs = new Map();
  const dispose = job => { clearTimeout(job.timer); job.controller.abort(aborted()); };
  const prune = () => {
    for (const [id, job] of jobs) if (job.until <= now()) { dispose(job); jobs.delete(id); }
    if (jobs.size >= maxJobs) for (const [id, job] of jobs) {
      if (job.done) { dispose(job); jobs.delete(id); if (jobs.size < maxJobs) break; }
    }
  };
  const owned = (id, owner) => {
    prune(); const job = jobs.get(id);
    if (job && job.owner !== String(owner)) throw fail(404, 'Không tìm thấy tác vụ');
    return job;
  };
  const snapshot = job => {
    const tracks = new Map();
    for (const part of [job.parts.embedded, job.parts.external]) for (const t of part?.tracks || []) {
      if (t?.id && (!tracks.has(t.id) || (t.ready && !tracks.get(t.id).ready))) tracks.set(t.id, t);
    }
    return { kind: 'inventory', jobId: job.id, version: job.version, done: job.done,
      cancelled: job.cancelled || false, tracks: [...tracks.values()].slice(0, 128),
      audio: job.parts.embedded?.audio || job.parts.external?.audio || [],
      probe: job.parts.embedded?.probe || job.parts.external?.probe || null,
      match: job.parts.external?.match || { checked: false, languages: {} },
      note: job.errors.length ? job.errors.join(' ') : job.parts.external?.note || job.parts.embedded?.note
        || (job.done ? '' : 'Đang tìm thêm phụ đề; các track đã có vẫn dùng được.'),
      pending: { external: !job.done && !job.finished.external, embedded: !job.done && job.embeddedRequested && !job.finished.embedded } };
  };
  const launch = (job, phase) => {
    const signal = job.controller.signal;
    const publish = patch => {
      if (signal.aborted || job.done) return;
      const current = job.parts[phase] || {};
      const tracks = new Map((current.tracks || []).map(t => [t.id, t]));
      for (const track of patch?.tracks || []) if (track?.id) {
        const previous = tracks.get(track.id);
        tracks.set(track.id, { ...previous, ...track, label: previous?.label || track.label });
      }
      job.parts[phase] = { ...current, ...patch, tracks: [...tracks.values()].slice(0, 128) };
      job.version++;
    };
    void Promise.resolve().then(() => {
      signal.throwIfAborted(); return (phase === 'external' ? external : embedded)(job.input, { signal, publish });
    }).then(data => publish(data)).catch(() => {
      if (!signal.aborted) job.errors.push(phase === 'external'
        ? 'Một dịch vụ phụ đề chưa phản hồi; bạn vẫn có thể dùng track đã sẵn sàng.'
        : 'Chưa chuẩn bị được phụ đề nhúng; các track khác vẫn dùng được.');
    }).finally(() => {
      if (signal.aborted) return;
      job.finished[phase] = true; job.version++;
      job.done = job.finished.external && (!job.embeddedRequested || job.finished.embedded);
      if (job.done) { clearTimeout(job.timer); job.until = now() + retentionMs; }
    });
  };
  const arm = job => {
    clearTimeout(job.timer);
    job.until = now() + Math.max(retentionMs, timeoutMs);
    job.timer = setTimeout(() => {
      job.done = true; job.version++; job.errors.push('Đã hết thời gian tìm thêm phụ đề. Bạn có thể thử lại.');
      dispose(job);
    }, timeoutMs); job.timer.unref?.();
  };
  return {
    start(owner, key, input, { id, includeEmbedded = false } = {}) {
      prune(); let job = id ? owned(id, owner) : null;
      if (job && (job.key !== key || job.cancelled || job.controller.signal.aborted)) {
        dispose(job); job.done = true; job.cancelled = true; job = null;
      }
      if (!job) {
        const active = [...jobs.values()].filter(j => !j.done);
        if (jobs.size >= maxJobs || active.length >= maxActive || active.filter(j => j.owner === String(owner)).length >= perUser)
          throw fail(503, 'Đang có nhiều tác vụ phụ đề; vui lòng thử lại sau ít giây.');
        job = { id: crypto.randomBytes(16).toString('hex'), owner: String(owner), key, input,
          controller: new AbortController(), parts: {}, finished: { external: false, embedded: false }, errors: [], version: 0,
          done: false, embeddedRequested: false, until: now() + retentionMs };
        jobs.set(job.id, job); arm(job); launch(job, 'external');
      }
      if (includeEmbedded && !job.embeddedRequested) {
        job.embeddedRequested = true; job.done = false; job.input = input; arm(job); launch(job, 'embedded');
      }
      return snapshot(job);
    },
    get(id, owner) { const job = owned(id, owner); return job ? snapshot(job) : null; },
    cancel(id, owner) { const job = owned(id, owner); if (!job) return false;
      dispose(job); job.done = true; job.cancelled = true; job.version++; return true; },
    close() { for (const job of jobs.values()) dispose(job); jobs.clear(); },
  };
};
