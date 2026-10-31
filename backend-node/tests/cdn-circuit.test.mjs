import assert from 'node:assert/strict';
import { createCdnCircuit, torboxCdnCircuit, assertCdnAvailable } from '../services/debrid/cdnCircuit.js';
const url = 'https://nexus-230.apac.tb-cdn.pw/private-file?token=SECRET';
const failure = '[tcp] Connection to tcp://nexus-230.apac.tb-cdn.pw:443 failed: Connection timed out';
let clock = 0;
const circuit = createCdnCircuit({now:()=>clock,cooldownMs:60000,maxEntries:2});
assert.equal(circuit.recordFailure(url, failure), true);
assert.equal(circuit.remainingSeconds(url), 60);
assert.equal(circuit.remainingSeconds('https://nexus-230.apac.tb-cdn.pw/another-file'), 60);
assert.equal(circuit.remainingSeconds('https://nexus-270.apac.tb-cdn.pw/file'), 0);
assert.equal(circuit.remainingSeconds('https://api.torbox.app/file'), 0);
clock=60000;
assert.equal(circuit.remainingSeconds(url), 0, 'node is retried after cooldown');
for(const [text,options] of [[failure,{stopped:true}],['Packet duration -16 is out of range',{}],['HTTP 403 Forbidden',{}],['Connection timed out while reading',{}]]) {
  assert.equal(circuit.recordFailure(url,text,options),false);
}
assert.equal(circuit.recordFailure('https://not-torbox.example/file',failure),false);
assert.equal(circuit.recordFailure(url,failure.replace('230','270')),false,'failure must belong to this URL');
for(const n of [230,270,300]) circuit.recordFailure(`https://nexus-${n}.apac.tb-cdn.pw/file`,failure.replace('230',n));
assert.equal(circuit.remainingSeconds(url),0,'bounded host cache evicts oldest');
// Exercise the same gate used for both cached links and freshly minted links.
torboxCdnCircuit.recordFailure(url,failure);
assert.throws(()=>assertCdnAvailable(url),e=>e.code==='CDN_CONNECT_COOLDOWN' && e.retryAfterSeconds>0 && !e.message.includes('SECRET'));
assert.equal(assertCdnAvailable('https://nexus-270.apac.tb-cdn.pw/file'),'https://nexus-270.apac.tb-cdn.pw/file');
console.log('ok - confirmed TCP failures skip only the affected TorBox node, with expiry and no credential retention');

// Verify the real TorBox adapter cannot bypass the gate via Redis or requestdl.
process.env.REDIS_CACHE_URL = 'redis://127.0.0.1:1';
const { cacheClient } = await import('../config/redis.js');
const { getDownloadUrl } = await import('../services/debrid/torbox.js');
const originalFetch = globalThis.fetch;
let requests = 0;
try {
  cacheClient.get = async () => url;
  cacheClient.set = async () => 'OK';
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({success:true,data:url}),{status:200,headers:{'content-type':'application/json'}});
  };
  const input={torrentId:1,fileId:2,userId:'fixture'};
  await assert.rejects(getDownloadUrl('fixture-key',input),e=>e.code==='CDN_CONNECT_COOLDOWN');
  assert.equal(requests,0,'blocked cached link must not spend an API request');
  await assert.rejects(getDownloadUrl('fixture-key',{...input,forceRefresh:true}),e=>e.code==='CDN_CONNECT_COOLDOWN');
  assert.equal(requests,1,'fresh requestdl links are checked too');
  const healthy='https://nexus-270.apac.tb-cdn.pw/file';
  cacheClient.get=async()=>healthy;
  assert.equal(await getDownloadUrl('fixture-key',input),healthy);
  console.log('ok - real cached/fresh download URL paths enforce node cooldown; healthy cached URL stays fast');
} finally {
  globalThis.fetch=originalFetch;
  cacheClient.disconnect();
}
