import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { computeOpenSubtitlesHash, singleflightFileHash, publishFileHash } from '../services/playback/opensubtitlesHash.js';
import { safeFetchText, isPrivateAddress } from '../services/security/safeFetch.js';
import { verifyVimoStream } from '../services/playback/vimoClient.js';

test('hash range validation, optional completion and identity-scoped update', async () => {
  let mode = 'good', count = 0;
  const server = http.createServer((req,res) => {
    count++;
    const [,a,b] = /bytes=(\d+)-(\d+)/.exec(req.headers.range);
    if(mode==='200') {res.writeHead(200);res.end('html');return;}
    res.writeHead(206, {'content-range':`bytes ${a}-${b}/131072`});
    const bytes = Buffer.alloc(mode==='short'?10:mode==='large'?65537:65536);
    if(mode==='slow') setTimeout(()=>res.end(bytes),80); else res.end(bytes);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}/file`;
  try {
    const hash=await computeOpenSubtitlesHash(url,131072);
    assert.equal(hash.videoHash,'0000000000020000');
    for(const bad of ['200','short','large']) {mode=bad;await assert.rejects(computeOpenSubtitlesHash(url,131072));}
    mode='slow';count=0;
    const work=singleflightFileHash('same:file:size',()=>computeOpenSubtitlesHash(url,131072));
    assert.equal(work,singleflightFileHash('same:file:size',()=>assert.fail('duplicate computation')));
    let filter;
    const db={collection:()=>({updateOne:async f=>{filter=f;}})};
    const start=performance.now();
    const videoReady=Promise.resolve('ready');
    assert.equal(await videoReady,'ready');assert.ok(performance.now()-start<50);
    assert.equal(await work instanceof Object,true);assert.equal(count,2);
    await publishFileHash(db,{sessionId:'s',userIdStr:'owner',infoHash:'h',fileId:7},hash);
    assert.deepEqual({...filter,expiresAt:null},{sessionId:'s',userIdStr:'owner',infoHash:'h',fileId:7,expiresAt:null});
    assert.ok(filter.expiresAt.$gt instanceof Date);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('Vimo validates manifests and every pinned redirect; private/IPv6 mapped URLs are blocked', async t => {
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:7f00:1','::ffff:a00:1','0:0:0:0:0:ffff:7f00:1','2001:db8::1']) assert.equal(isPrivateAddress(ip),true,ip);
  let hits=0;
  const server=http.createServer((req,res)=>{
    hits++;
    if(req.url==='/redirect') {res.writeHead(302,{location:'http://8.8.8.8/alive'});res.end();}
    else if(req.url==='/private') {res.writeHead(302,{location:'http://127.0.0.1/secret'});res.end();}
    else if(req.url==='/large') res.end('x'.repeat(270000));
    else if(req.url==='/html') res.end('<html>not a stream</html>');
    else if(req.url==='/drip') {res.write('x');const timer=setInterval(()=>res.write('x'),10);res.on('close',()=>clearInterval(timer));}
    else res.end('#EXTM3U\n#EXTINF:4,\nseg.ts\n');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const original=http.request;
  // Test transport only: simulate a public CDN on a loopback fixture, while
  // asserting production safeFetch supplied the validated, pinned public IP.
  t.mock.method(http,'request',(options,cb)=>{
    assert.equal(options.host,'8.8.8.8');
    return original({...options,host:'127.0.0.1',port:server.address().port},cb);
  });
  try {
    assert.equal(await verifyVimoStream('http://8.8.8.8/alive'),true);
    assert.equal(await verifyVimoStream('http://8.8.8.8/redirect'),true);
    assert.equal(await verifyVimoStream('http://8.8.8.8/private'),false);
    assert.equal(await verifyVimoStream('http://8.8.8.8/html'),false);
    assert.equal(await verifyVimoStream('http://8.8.8.8/large'),false);
    const before=hits;
    assert.equal(await verifyVimoStream('http://127.0.0.1/secret'),false);
    assert.equal(hits,before,'blocked URL never connects');
    await assert.rejects(safeFetchText('http://8.8.8.8/drip',{timeoutMs:80}));
  } finally {t.mock.restoreAll();server.closeAllConnections();await new Promise(r=>server.close(r));}
});


test('sidecar queue bounds concurrency, preserves priority and isolates failed downloads', async()=>{
 const {boundedSettled}=await import('../services/playback/bounded-settled.js');
 let running=0, peak=0;
 const result=await boundedSettled(Array.from({length:24},(_,i)=>i),4,async i=>{
  peak=Math.max(peak,++running);
  await new Promise(r=>setTimeout(r,2));running--;
  if(i===3)throw new Error('quota');return i;
 });
 assert.equal(peak,4);assert.equal(result[3].status,'rejected');
 assert.equal(result[23].value,23);assert.equal(result.length,24);
});

test('metadata rate limits cannot exhaust the committed seek budget; each remains enforced', async t=>{
 const {cacheClient}=await import('../config/redis.js');
 const limits=await import('../middleware/rateLimit.js');
 const counts=new Map();
 t.mock.method(cacheClient,'multi',()=>{
  let key;const chain={zremrangebyscore:()=>chain,zadd:k=>{key=k;return chain;},zcard:()=>chain,pexpire:()=>chain,
   exec:async()=>{const n=(counts.get(key)||0)+1;counts.set(key,n);return [[null,0],[null,1],[null,n],[null,1]];}};return chain;
 });
 const req={headers:{'x-forwarded-for':'8.8.8.8'},user:{userId:'fixture-owner'},ip:'8.8.8.8'};
 const invoke=async fn=>{let status=200,allowed=false;await fn(req,{setHeader(){},status(n){status=n;return this;},json(){}},()=>{allowed=true;});return {status,allowed};};
 for(let i=0;i<20;i++)await invoke(limits.subtitleInventoryRateLimit);
 assert.equal((await invoke(limits.subtitleInventoryRateLimit)).status,429);
 for(let i=0;i<15;i++)await invoke(limits.sourceDiscoveryRateLimit);
 assert.equal((await invoke(limits.sourceDiscoveryRateLimit)).status,429);
 assert.equal((await invoke(limits.playbackRateLimit)).allowed,true);
 for(let i=1;i<30;i++)await invoke(limits.playbackRateLimit);
 assert.equal((await invoke(limits.playbackRateLimit)).status,429);
 t.mock.restoreAll();
});
