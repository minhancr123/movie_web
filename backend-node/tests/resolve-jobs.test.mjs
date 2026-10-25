import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {createResolveJobs} from '../services/playback/resolveJobs.js';
class Response extends EventEmitter {statusCode=200;writableEnded=false;headers={};status(code){this.statusCode=code;return this;}set(k,v){this.headers[k]=v;return this;}json(body){this.body=body;this.writableEnded=true;this.emit('finish');return this;}}
const request=(user='A',id)=>({user:{userId:user},body:{resolveId:'resolve-example-123'},params:{jobId:id}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('fast direct requests keep their ordinary HTTP response and have no poll state',async()=>{
 const jobs=createResolveJobs({handler:async(req,res)=>res.json({success:true,data:{mode:'direct',sessionId:req.user.userId}})});
 const res=new Response();await jobs.start(request(),res);assert.equal(res.statusCode,200);assert.equal(res.body.data.mode,'direct');assert.equal(jobs.size,0);jobs.close();
});
test('capacity wait becomes 202; only the owning user can read or cancel the result',async()=>{
 let finish;const jobs=createResolveJobs({handler:async(req,res)=>{req.resolveJobContext.markWaiting();await new Promise(r=>{finish=r;});return res.json({success:true,data:{mode:'remux',sessionId:'private-session'}});}});
 const res=new Response();await jobs.start(request(),res);assert.equal(res.statusCode,202);const id=res.body.data.jobId;
 const other=new Response();jobs.poll(request('B',id),other);assert.equal(other.statusCode,404);assert.ok(!JSON.stringify(other.body).includes('private-session'));
 const denied=new Response();jobs.cancel(request('B',id),denied);assert.equal(denied.statusCode,404);
 finish();await tick();const owner=new Response();jobs.poll(request('A',id),owner);assert.equal(owner.statusCode,200);assert.equal(owner.body.data.sessionId,'private-session');jobs.close();
});
test('waiting clients get the actual error status instead of a successful fake completion',async()=>{
 let finish;const jobs=createResolveJobs({handler:async(req,res)=>{req.resolveJobContext.markWaiting();await new Promise(r=>{finish=r;});return res.status(422).json({success:false,code:'NO_COMPATIBLE_SOURCE'});}});
 const res=new Response();await jobs.start(request(),res);finish();await tick();const out=new Response();jobs.poll(request('A',res.body.data.jobId),out);assert.equal(out.statusCode,422);assert.equal(out.body.code,'NO_COMPATIBLE_SOURCE');jobs.close();
});
test('abandoned leases abort the worker and completed results expire without leaking jobs',async()=>{
 let time=0,aborted=false;const jobs=createResolveJobs({leaseMs:10,retainMs:10,now:()=>time,handler:async(req,res)=>{req.resolveJobContext.markWaiting();await new Promise(resolve=>res.once('close',()=>{aborted=true;resolve();}));}});
 const res=new Response();await jobs.start(request(),res);time=11;jobs.sweep();await tick();assert.equal(aborted,true);time=22;jobs.sweep();assert.equal(jobs.size,0);jobs.close();
});
test('observers that do not return next() still await the entire asynchronous handler',async()=>{
 const jobs=createResolveJobs({observe:(_req,_res,next)=>{next();},handler:async(_req,res)=>{await tick();return res.json({success:true});}});
 const res=new Response();await jobs.start(request(),res);assert.equal(res.statusCode,200);assert.equal(res.body.success,true);jobs.close();
});
test('per-user admission limit cannot consume another viewer quota',async()=>{
 const jobs=createResolveJobs({maxPerUser:1,handler:async(req,res)=>{req.resolveJobContext.markWaiting();await new Promise(resolve=>res.once('close',resolve));}});
 const first=new Response();await jobs.start(request(),first);const second=new Response();await jobs.start(request(),second);assert.equal(second.statusCode,503);
 const other=new Response();await jobs.start(request('B'),other);assert.equal(other.statusCode,202);jobs.close();
});

test('a socket destroyed before the 202 handoff aborts its worker',async()=>{
 let aborted=false;const jobs=createResolveJobs({handler:async(req,res)=>{req.resolveJobContext.markWaiting();await new Promise(resolve=>res.once('close',()=>{aborted=true;resolve();}));}});
 const res=new Response();res.destroyed=true;await jobs.start(request(),res);await tick();assert.equal(aborted,true);jobs.close();
});
test('an owned pending-job poll renews stage presence; another account cannot',async()=>{
 let touches=0;const jobs=createResolveJobs({touchStage:()=>{touches++;},handler:async(req,res)=>{req.resolveJobContext.markWaiting();await new Promise(resolve=>res.once('close',resolve));}});
 const res=new Response();await jobs.start(request(),res);const id=res.body.data.jobId;
 jobs.poll(request('B',id),new Response());assert.equal(touches,0);
 jobs.poll(request('A',id),new Response());assert.equal(touches,1);jobs.close();
});

test('lease expiry delivers a terminal timeout, never a silently ignored superseded response',async()=>{
 let time=0;const jobs=createResolveJobs({leaseMs:10,now:()=>time,handler:async(req,res)=>{req.resolveJobContext.markWaiting();await new Promise(resolve=>res.once('close',resolve));res.status(499).json({code:'RESOLVE_SUPERSEDED'});}});
 const res=new Response();await jobs.start(request(),res);const id=res.body.data.jobId;time=11;jobs.sweep();await tick();
 const out=new Response();jobs.poll(request('A',id),out);assert.equal(out.statusCode,504);assert.equal(out.body.code,'RESOLVE_JOB_TIMEOUT');jobs.close();
});
