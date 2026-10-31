import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreparedSourceCache } from '../services/playback/preparedSourceCache.js';
const request = { infoHash: 'A'.repeat(40), assumeCached: true };
const result = () => ({state:'ready', torrentId:7, files:[{fileId:11, name:'episode.mkv'}]});

test('coalesces parallel prewarm/resolve calls and reuses metadata on seeks, with cloned results', async () => {
  let calls=0;
  const prepare=createPreparedSourceCache(async()=>{calls++;return result();});
  const [a,b]=await Promise.all([prepare('account-a',request),prepare('account-a',request)]);
  a.files[0].name='mutated';
  assert.equal(b.files[0].name,'episode.mkv');
  assert.equal((await prepare('account-a',{...request,infoHash:request.infoHash.toLowerCase()})).files[0].name,'episode.mkv');
  assert.equal(calls,1);
});

test('never shares between credentials or torrents; expires and bounds cached inventories', async () => {
  let calls=0;let clock=0;
  const prepare=createPreparedSourceCache(async()=>{calls++;return result();},{now:()=>clock,ttlMs:30,maxEntries:2});
  await prepare('a',request);await prepare('b',request);assert.equal(calls,2);
  await prepare('a',{...request,infoHash:'b'.repeat(40)});assert.equal(calls,3);
  await prepare('a',request);assert.equal(calls,4,'oldest inventory evicted');
  clock=31;await prepare('a',request);assert.equal(calls,5,'expired inventory refetched');
});

test('a successful fresh prewarm primes a later resolve without another account scan', async () => {
  let calls=0;
  const prepare=createPreparedSourceCache(async()=>{calls++;return result();});
  await prepare('a',{...request,assumeCached:false});
  await prepare('a',request);
  assert.equal(calls,1);
  await prepare('a',{...request,assumeCached:false});
  assert.equal(calls,2,'explicit fresh scan still contacts TorBox');
});

test('does not cache downloading, empty or failed inventories; fresh scans invalidate ready data', async () => {
  let value={state:'downloading',files:[]};let calls=0;
  const prepare=createPreparedSourceCache(async()=>{calls++;if(value instanceof Error)throw value;return value;});
  await prepare('a',request);await prepare('a',request);assert.equal(calls,2);
  value={state:'ready',files:[]};await prepare('a',request);await prepare('a',request);assert.equal(calls,4);
  value=new Error('timeout');await assert.rejects(prepare('a',request));
  value=result();await prepare('a',request);await prepare('a',request);assert.equal(calls,6);
  value=new Error('token revoked');await assert.rejects(prepare('a',{...request,assumeCached:false}));
  await assert.rejects(prepare('a',request));assert.equal(calls,8,'no stale cached success after fresh refusal');
});

test('a superseded cached lookup cannot refill the cache after an explicit fresh scan', async () => {
  let finish;let calls=0;
  const prepare=createPreparedSourceCache(async(_key,req)=>{calls++;if(req.assumeCached&&calls===1)return new Promise(r=>{finish=r;});return {state:'downloading',files:[]};});
  const pending=prepare('a',request);
  await Promise.resolve();
  await prepare('a',{...request,assumeCached:false});
  finish(result());await pending;
  assert.equal((await prepare('a',request)).state,'downloading');
  assert.equal(calls,3);
});


test('default ready-inventory cache covers nearby seeks for two minutes without caching links', async () => {
  let calls=0; let clock=0;
  const prepare=createPreparedSourceCache(async()=>{calls++;return result();},{now:()=>clock});
  await prepare('a',request);
  clock=119999; await prepare('a',request); assert.equal(calls,1);
  clock=120001; await prepare('a',request); assert.equal(calls,2);
});
