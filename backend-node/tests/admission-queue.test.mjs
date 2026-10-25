import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdmissionQueue,createRenditionGate} from '../services/playback/admissionQueue.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(limit=1,settings={}) {
 const held=new Set();let serial=0;
 const queue=createAdmissionQueue({intervalMs:100000,
  tryAcquire:async()=>held.size<limit?{admitted:true,reservationId:(()=>{const id=++serial;held.add(id);return id;})()}:{admitted:false},
  release:id=>held.delete(id),...settings});
 return {queue,held,release:id=>held.delete(id)};
}
test('four slots admit four of twelve requests, never oversubscribe, and drain on release',async()=>{
 const f=fixture(4),resolved=[];
 const requests=Array.from({length:12},(_,i)=>f.queue.acquire().then(r=>{resolved.push(r);return r;}));
 await tick();assert.equal(resolved.length,4);assert.equal(f.held.size,4);assert.equal(f.queue.size,8);
 for(let batch=0;batch<2;batch++) {for(const r of resolved.splice(0))f.release(r.reservationId);await f.queue.pump();await tick();assert.equal(resolved.length,4);}
 await Promise.all(requests);f.queue.close();
});
test('foreground seeks outrank new plays and prefetch, with FIFO within a priority',async()=>{
 const f=fixture();const first=await f.queue.acquire();const order=[];
 const add=(name,priority)=>f.queue.acquire({}, {priority}).then(r=>{order.push(name);return r;});
 const background=add('prefetch',2),play=add('play',1),seek=add('seek',0);
 await tick();f.release(first.reservationId);await f.queue.pump();const a=await seek;
 f.release(a.reservationId);await f.queue.pump();const b=await play;
 f.release(b.reservationId);await f.queue.pump();await background;
 assert.deepEqual(order,['seek','play','prefetch']);f.queue.close();
});
test('aging stops background starvation without changing the writer limit',async()=>{
 let time=0;const f=fixture(1,{now:()=>time});const first=await f.queue.acquire();const order=[];
 const old=f.queue.acquire({}, {priority:2}).then(r=>{order.push('old');return r;});await tick();time=120000;
 const newer=f.queue.acquire({}, {priority:0}).then(r=>{order.push('new');return r;});await tick();
 f.release(first.reservationId);await f.queue.pump();const a=await old;
 f.release(a.reservationId);await f.queue.pump();await newer;assert.deepEqual(order,['old','new']);f.queue.close();
});
test('cancelled waiters vanish immediately and cannot take the next slot',async()=>{
 const f=fixture(),controller=new AbortController();const first=await f.queue.acquire();
 const pending=f.queue.acquire({}, {signal:controller.signal});
 const rejected=assert.rejects(pending,{code:'RESOLVE_SUPERSEDED'});controller.abort();await rejected;
 assert.equal(f.queue.size,0);assert.equal(f.held.size,1);f.release(first.reservationId);f.queue.close();
});
test('cancellation racing an asynchronous admission returns the held reservation',async()=>{
 let grant,returned=[];const f=createAdmissionQueue({intervalMs:100000,tryAcquire:()=>new Promise(r=>{grant=r;}),release:id=>returned.push(id)});
 const abort=new AbortController();const p=f.acquire({}, {signal:abort.signal});const rejected=assert.rejects(p,{code:'RESOLVE_SUPERSEDED'});
 abort.abort();await rejected;grant({admitted:true,reservationId:'late'});await tick();assert.deepEqual(returned,['late']);f.close();
});
test('queue bounds, expiry and progress are explicit',async()=>{
 let time=0;const states=[];const f=fixture(0,{maxPending:1,maxWaitMs:100,now:()=>time});
 const waiting=f.queue.acquire({}, {onWait:p=>states.push(p)});await tick();
 await assert.rejects(f.queue.acquire(),{code:'REMUX_QUEUE_FULL'});
 const expired=assert.rejects(waiting,{code:'REMUX_QUEUE_TIMEOUT'});time=101;await f.queue.pump();await expired;
 assert.deepEqual(states,[{position:1,total:1}]);assert.equal(f.queue.size,0);f.queue.close();
});
test('cross-user cold-start gate creates one build and lets twelve owners reuse its publication',async()=>{
 const gate=createRenditionGate(),f=fixture(4);let built=false,writers=0,reused=0;
 await Promise.all(Array.from({length:12},async()=>{
  const release=await gate.acquire('same-file:audio0:window0');
  try {if(built){reused++;return;}const slot=await f.queue.acquire();writers++;await tick();built=true;f.release(slot.reservationId);}
  finally{release();}
 }));assert.equal(writers,1);assert.equal(reused,11);assert.equal(gate.size,0);f.queue.close();
});
test('a cancelled gate follower leaves other owners intact and a failed leader can be replaced',async()=>{
 const gate=createRenditionGate(),release=await gate.acquire('key');const abort=new AbortController();
 const cancelled=gate.acquire('key',{signal:abort.signal});const check=assert.rejects(cancelled,{code:'RESOLVE_SUPERSEDED'});abort.abort();await check;
 const next=gate.acquire('key');release();release();const finish=await next;finish();assert.equal(gate.size,0);
});
