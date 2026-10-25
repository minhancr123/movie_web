import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

/** Detach only when a real capacity/key wait occurs, keeping fast paths fast.
 * Polling is both ownership-checked delivery and a lease for pending work. */
export function createResolveJobs({ handler, observe = (_req,_res,next) => next(), readStage = () => null,
  touchStage = () => {}, maxJobs = 256, maxPerUser = 4, leaseMs = 90_000, lifetimeMs = 15*60_000,
  retainMs = 60_000, now = Date.now, sweepMs = 5000 } = {}) {
  const jobs = new Map();
  const owner = req => String(req.user?.userId || '');
  const pendingBody = job => {
    const stage = readStage(job.resolveId);
    return { success:true, data:{mode:'resolve_pending',jobId:job.id,
      stage:stage?.stage || 'waiting_writer',detail:stage?.detail || 'Đang chờ lượt phát'} };
  };
  const cancel = job => {
    if (job.done) return;
    // The controller owns its switch signal and listens to this close event.
    job.response.emit('close');
    job.response.status(499).json({success:false,code:'RESOLVE_SUPERSEDED',message:'Đã hủy yêu cầu phát'});
  };
  const sweep = () => {
    for (const [id,job] of jobs) {
      if (!job.done && (now()-job.created >= lifetimeMs || (job.detached && now()-job.seen >= leaseMs))) cancel(job);
      if (job.done && now()-job.finished >= retainMs) jobs.delete(id);
    }
  };
  const timer = setInterval(sweep,sweepMs); timer.unref?.();
  const lookup = (req,res) => {
    const job = jobs.get(String(req.params?.jobId || ''));
    if (!job || job.owner !== owner(req)) {
      res.status(404).json({success:false,code:'RESOLVE_JOB_GONE',message:'Yêu cầu chờ không còn. Vui lòng mở lại phim.'}); return null;
    }
    return job;
  };
  return {
    async start(req,res) {
      sweep();
      if (!owner(req)) return res.status(401).json({success:false});
      if (jobs.size >= maxJobs || [...jobs.values()].filter(j => !j.done && j.owner===owner(req)).length >= maxPerUser) {
        return res.status(503).json({success:false,code:'REMUX_QUEUE_FULL',message:'Hàng chờ đang đầy. Vui lòng thử lại sau.'});
      }
      let complete, waiting;
      const completed = new Promise(resolve => { complete = resolve; });
      const queued = new Promise(resolve => { waiting = resolve; });
      const response = new EventEmitter();
      Object.assign(response,{statusCode:200,writableEnded:false,headers:{},
        status(code) { this.statusCode=code; return this; },
        set(key,value) { this.headers[key]=value; return this; },
        setHeader(key,value) { this.headers[key]=value; return this; },
        json(body) {
          if (this.writableEnded) return this;
          this.writableEnded=true; job.done=true; job.finished=now(); job.body=body;
          response.emit('finish'); complete('complete'); return this;
        },
      });
      const job={id:randomBytes(18).toString('base64url'),owner:owner(req),resolveId:req.body?.resolveId,
        created:now(),seen:now(),response,done:false,detached:false};
      jobs.set(job.id,job);
      const jobRequest = Object.assign(Object.create(req), { resolveJobContext:{ markWaiting:() => waiting('queued') } });
      const onClose=() => { if (!res.writableEnded) cancel(job); };
      res.on('close',onClose);
      // Own the background rejection; no detached promise can crash Express.
      void Promise.resolve().then(() => {
        let work;
        observe(jobRequest,response,() => { work = handler(jobRequest,response); });
        return work;
      })
        .then(() => { if (!response.writableEnded) response.status(500).json({success:false,code:'RESOLVE_JOB_FAILED',message:'Không thể hoàn tất yêu cầu phát.'}); })
        .catch(() => response.status(500).json({success:false,code:'RESOLVE_JOB_FAILED',message:'Không thể chuẩn bị nguồn phát.'}));
      await Promise.race([completed,queued]);
      res.off('close',onClose);
      if (res.destroyed || res.writableEnded) { if (!job.done) cancel(job); return; }
      res.set('Cache-Control','private, no-store');
      if (job.done) { jobs.delete(job.id); return res.status(response.statusCode).json(job.body); }
      job.detached=true; job.seen=now();
      return res.status(202).json(pendingBody(job));
    },
    poll(req,res) {
      res.set('Cache-Control','private, no-store'); sweep();
      const job=lookup(req,res); if (!job) return;
      job.seen=now(); touchStage(job.resolveId);
      return job.done ? res.status(job.response.statusCode).json(job.body) : res.status(202).json(pendingBody(job));
    },
    cancel(req,res) {
      res.set('Cache-Control','private, no-store');
      const job=lookup(req,res); if (!job) return;
      cancel(job); return res.status(200).json({success:true});
    },
    sweep,
    get size() { return jobs.size; },
    close() { clearInterval(timer); for (const job of jobs.values()) cancel(job); jobs.clear(); },
  };
}
