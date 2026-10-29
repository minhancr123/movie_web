import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createSubtitleInventories } from '../services/playback/progressiveSubtitleInventory.js';
import { safeFetchText } from '../services/security/safeFetch.js';
const tick = () => new Promise(r => setImmediate(r));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const track = id => ({ id, ready: true, language: id === 'vi' ? 'vi' : 'en', label: id, url: '/safe/' + id });

test('ready embedded tracks arrive without waiting for a slow external service', async () => {
  const slow = deferred(); let publishExternal;
  const manager = createSubtitleInventories({
    external: async (_, { publish }) => { publishExternal = publish; await slow.promise; return { tracks: [track('vi')] }; },
    embedded: async () => ({ tracks: [track('en')], audio: [{ language: 'en' }] }),
  });
  try {
    const first = manager.start('a', 'movie:file:window', {}, { includeEmbedded: true });
    assert.equal(first.done, false); await tick();
    const partial = manager.get(first.jobId, 'a');
    assert.deepEqual(partial.tracks.map(t => t.id), ['en']); assert.equal(partial.done, false);
    publishExternal({ tracks: [track('vi')] });
    assert.deepEqual(manager.get(first.jobId, 'a').tracks.map(t => t.id), ['en','vi']);
    slow.resolve(); await tick(); assert.equal(manager.get(first.jobId, 'a').done, true);
  } finally { manager.close(); }
});

test('opening settings upgrades the same subscription and preserves already ready tracks', async () => {
  const slow = deferred(); let externalCalls = 0, embeddedCalls = 0;
  const manager = createSubtitleInventories({ external: async () => { externalCalls++; return { tracks: [track('vi')] }; },
    embedded: async () => { embeddedCalls++; await slow.promise; return { tracks: [track('en')] }; } });
  try {
    const first = manager.start('a','same',{}); await tick(); assert.equal(manager.get(first.jobId,'a').done,true);
    const upgrade = manager.start('a','same',{}, { id:first.jobId, includeEmbedded:true });
    assert.equal(upgrade.jobId,first.jobId); assert.equal(upgrade.done,false); assert.equal(upgrade.tracks[0].id,'vi');
    slow.resolve(); await tick(); assert.equal(manager.get(first.jobId,'a').tracks.length,2);
    assert.equal(externalCalls,1); assert.equal(embeddedCalls,1);
  } finally { manager.close(); }
});

test('foreign owners, cancellation and a late producer cannot leak or repaint another subscription', async () => {
  let publish, signal; const slow = deferred();
  const manager=createSubtitleInventories({ external:async (_,o)=>{publish=o.publish;signal=o.signal;await slow.promise;}, embedded:async()=>({}) });
  try {
    const a=manager.start('a','A',{});await tick();
    assert.throws(()=>manager.get(a.jobId,'b'),{status:404});
    assert.throws(()=>manager.cancel(a.jobId,'b'),{status:404});
    manager.cancel(a.jobId,'a');assert.equal(signal.aborted,true);
    publish({tracks:[track('stale')]});slow.resolve();await tick();
    assert.equal(manager.get(a.jobId,'a').tracks.length,0);assert.equal(manager.get(a.jobId,'a').cancelled,true);
  } finally { manager.close(); }
});

test('a new seek window cancels the old job, and limits stop unbounded provider work', async () => {
  const slow=deferred();const manager=createSubtitleInventories({perUser:1,maxActive:2,
    external:async()=>slow.promise,embedded:async()=>({})});
  try{
    const a=manager.start('a','window0',{});
    assert.throws(()=>manager.start('a','second-tab',{}),{status:503});
    const b=manager.start('a','window120',{}, {id:a.jobId});
    assert.notEqual(a.jobId,b.jobId);assert.equal(manager.get(a.jobId,'a').cancelled,true);
    manager.start('b','other',{});assert.throws(()=>manager.start('c','excess',{}),{status:503});slow.resolve();await tick();
  }finally{manager.close();}
});

test('timeout retains ready tracks and retires the unfinished producer', async()=>{
 const slow=deferred();const manager=createSubtitleInventories({timeoutMs:20,
  external:async(_,o)=>{o.publish({tracks:[track('vi')]});await slow.promise;},embedded:async()=>({})});
 try{const a=manager.start('a','A',{});await new Promise(r=>setTimeout(r,40));const result=manager.get(a.jobId,'a');
 assert.equal(result.done,true);assert.equal(result.tracks[0].id,'vi');assert.match(result.note,/hết thời gian/);slow.resolve();}finally{manager.close();}
});

test('cancelling safeFetch closes the pinned socket rather than only discarding its result',async t=>{
 const server=http.createServer((req,res)=>{res.write('first');const timer=setInterval(()=>res.write('drip'),20);res.on('close',()=>clearInterval(timer));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let socketClosed=false;server.on('connection',s=>s.on('close',()=>{socketClosed=true;}));
 const original=http.request;t.mock.method(http,'request',(options,cb)=>{assert.equal(options.host,'8.8.8.8');return original({...options,host:'127.0.0.1',port:server.address().port},cb);});
 try{const controller=new AbortController();const result=safeFetchText('http://8.8.8.8/slow',{signal:controller.signal,timeoutMs:10000});setTimeout(()=>controller.abort(),40);
 await assert.rejects(result,{name:'AbortError'});await new Promise(r=>setTimeout(r,25));assert.equal(socketClosed,true);
 }finally{t.mock.restoreAll();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
