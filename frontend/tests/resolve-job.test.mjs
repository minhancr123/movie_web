import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const ctx={exports:{},setTimeout,clearTimeout,Date};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/resolve-job.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,ctx);
const {completeResolveRequest}=ctx.exports;
const id='private-queue-ticket-123';
const pending={status:202,data:{success:true,data:{mode:'resolve_pending',jobId:id}}};
const done={status:200,data:{success:true,data:{mode:'remux',startOffset:116.7,requestedPositionSeconds:120}}};
test('fast responses do not poll or cancel anything',async()=>{
 const result=await completeResolveRequest(async()=>done,{poll:()=>assert.fail(),cancel:()=>assert.fail()});assert.equal(result,done);
});
test('six queue polls keep one resolve and preserve the requested destination',async()=>{
 let posts=0,polls=0;const targets=[];
 const result=await completeResolveRequest(async()=>{posts++;return pending;},{intervalMs:0,poll:async ticket=>{targets.push(ticket);return ++polls<6?pending:done;},cancel:()=>assert.fail()});
 assert.equal(posts,1);assert.equal(polls,6);assert.ok(targets.every(t=>t===id));assert.equal(result.data.data.requestedPositionSeconds,120);
});
test('a superseded seek cancels its owned ticket once and never polls again',async()=>{
 const abort=new AbortController();let cancelCount=0;
 const promise=completeResolveRequest(async()=>pending,{signal:abort.signal,intervalMs:1000,poll:()=>assert.fail(),cancel:async ticket=>{assert.equal(ticket,id);cancelCount++;}});
 await new Promise(resolve=>setImmediate(resolve));abort.abort();await assert.rejects(promise,{code:'ERR_CANCELED'});assert.equal(cancelCount,1);
});
test('poll errors retain the original HTTP failure and abandon the queue work',async()=>{
 const error=Object.assign(new Error('expired'),{response:{status:404,data:{code:'RESOLVE_JOB_GONE'}}});let cancelled=0;
 await assert.rejects(completeResolveRequest(async()=>pending,{intervalMs:0,poll:async()=>{throw error;},cancel:async()=>{cancelled++;}}),e=>e===error);assert.equal(cancelled,1);
});
test('one network interruption only retries polling and never starts a duplicate resolve',async()=>{
 let posts=0,polls=0;await completeResolveRequest(async()=>{posts++;return pending;},{intervalMs:0,poll:async()=>{if(++polls===1)throw new Error('network');return done;},cancel:()=>assert.fail()});assert.equal(posts,1);assert.equal(polls,2);
});
test('malformed or switched queue tickets never trigger an arbitrary request',async()=>{
 await assert.rejects(completeResolveRequest(async()=>({...pending,data:{data:{mode:'resolve_pending',jobId:'../private'}}}),{intervalMs:0,poll:()=>assert.fail(),cancel:()=>assert.fail()}),/không hợp lệ/);
 let cancellations=0;await assert.rejects(completeResolveRequest(async()=>pending,{intervalMs:0,poll:async()=>({...pending,data:{data:{mode:'resolve_pending',jobId:'different-private-ticket-123'}}}),cancel:async()=>{cancellations++;}}),/không hợp lệ/);assert.equal(cancellations,1);
});
test('completion removes abort listeners and a later cancellation cannot stop a playing session',async()=>{
 const signal=new AbortController();let cancellations=0;await completeResolveRequest(async()=>pending,{intervalMs:0,signal:signal.signal,poll:async()=>done,cancel:async()=>{cancellations++;}});signal.abort();assert.equal(cancellations,0);
});
