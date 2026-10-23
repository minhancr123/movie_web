import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'cinevn-probe-test-'));
const count = path.join(scratch, 'calls');
const fake = path.join(scratch, 'probe');
await fs.writeFile(fake, `#!/bin/sh\necho x >> '${count}'\nsleep 0.05\nprintf '%s' '{"streams":[],"format":{"duration":"12"}}'\n`, {mode:0o700});
process.env.FFPROBE_BIN = fake;
process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/cinevn_test';
process.env.REDIS_CACHE_URL = 'redis://127.0.0.1:1';
const m = await import('../services/playback/remuxService.js');
const stages = await import('../services/playback/resolveProgress.js');
const o = await import('../services/playback/orchestrator.js');
const metrics = await import('../services/observability/metrics.js');
const telemetry = await import('../controllers/playbackTelemetryController.js');
const {cacheClient} = await import('../config/redis.js');

test('HTTP Range validates actual GET response and rejects misleading headers/status', async () => {
  const requests = [];
  const server = http.createServer((req,res) => {
    requests.push([req.method, req.headers.range]);
    if(req.url === '/slow') return;
    if(req.url === '/bad') {res.writeHead(404, {'accept-ranges':'bytes'}); res.end(); return;}
    if(req.url === '/lying') {res.writeHead(200, {'accept-ranges':'bytes'});res.end('whole film');return;}
    res.writeHead(206, {'content-range':'bytes 0-0/999','content-length':1});res.end('x');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await m.checkHttpRange(url+'/good')).supported,true);
    assert.equal((await m.checkHttpRange(url+'/good')).contentLength,999);
    assert.equal((await m.checkHttpRange(url+'/lying')).supported,false);
    assert.equal((await m.checkHttpRange(url+'/bad')).supported,false);
    assert.equal((await m.checkHttpRange(url+'/slow',30)).error,'timeout');
    assert(requests.every(([method,range])=>method==='GET'&&range==='bytes=0-0'));
  } finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); }
});
test('real ffprobe entry shares concurrent work, caches and isolates mutation', async () => {
  const [a,b] = await Promise.all([m.ffprobe('fixture:one'),m.ffprobe('fixture:one')]);
  a.durationSeconds=77;
  assert.notEqual(b.durationSeconds,77);
  await m.ffprobe('fixture:one');
  assert.equal((await fs.readFile(count,'utf8')).trim().split('\n').length,1);
  const now = Date.now;
  try { Date.now=()=>now()+8*86400_000; assert.equal(m.getCachedProbe('fixture:one'),null); }
  finally { Date.now=now; }
});
test('progress polling does not stop stage clock; finish is idempotent', () => {
  const now = Date.now; let at=1000; Date.now=()=>at;
  try {
    stages.clearResolveStages(); stages.setResolveStage('resolve-test-0001','sources');
    at=1100;stages.getResolveStage('resolve-test-0001');
    at=2000;stages.setResolveStage('resolve-test-0001','probe');
    at=3000;assert.equal(stages.finishResolveStages('resolve-test-0001'),true);
    at=4000;assert.equal(stages.finishResolveStages('resolve-test-0001'),false);
    const t=stages.getResolveTimings('resolve-test-0001');
    assert.deepEqual(t.stages.map(s=>s.durationMs),[1000,1000]);assert.equal(t.totalMs,2000);
  } finally { Date.now=now; }
});
test('orchestrator dispatches registered adapters and never falls back to unsupported media', async () => {
  const source={height:1080,codec:'h264'};
  o.registerAdapter('test',{getCandidates:async params=>[source,params]});
  assert.deepEqual(await o.coordinateResolve(null,{id:1},{provider:'test'}),[source,{id:1}]);
  const caps={hevc:false,hevcMain10:false,av1:false,maxHeight:1080};
  for (const fn of [o.selectBestSource,o.selectQualityForDevice]) assert.equal(fn([{codec:'hevc10',height:2160}],caps),null);
  assert.equal(o.selectBestSource([{codec:'hevc',profile:'Main 10',height:1080}],{...caps,hevc:true}),null);
});
test('client metrics count measured frames, seek and rebuffer with event validation/dedup', async () => {
  assert.equal(telemetry.parsePlaybackEvent({eventId:'valid-event',type:'seek',seconds:Infinity}),null);
  assert.equal(telemetry.parsePlaybackEvent({eventId:'valid-event',type:'summary',playedSeconds:100,stalledSeconds:30}),null);
  const event=telemetry.parsePlaybackEvent({eventId:'valid-event',type:'first_frame',seconds:2});
  assert.equal(telemetry.acceptPlaybackEvent('own-session',event,1000),true);
  assert.equal(telemetry.acceptPlaybackEvent('own-session',event,1001),false);
  assert.equal(telemetry.acceptPlaybackEvent('other-session',event,1001),true);
  metrics.recordPlaybackEvent({mode:'direct'},event);
  metrics.recordPlaybackEvent({mode:'direct'},{type:'seek',seconds:1});
  metrics.recordPlaybackEvent({mode:'direct'},{type:'summary',playedSeconds:20,stalledSeconds:2});
  const text=await metrics.register.metrics();
  assert.match(text,/playback_time_to_first_frame_seconds_sum\{source_type="direct",schema="latency-v3",generation="[0-9:]+"\} 2/);
  assert.match(text,/playback_seek_latency_seconds_sum\{method="direct",schema="latency-v3",generation="[0-9:]+"\} 1/);
  assert.match(text,/playback_rebuffer_seconds_total 2/);
  const dashboard=JSON.parse(await fs.readFile(new URL('../../deploy/grafana-dashboard.json',import.meta.url),'utf8'));
  const queries = dashboard.panels.flatMap(panel => panel.targets || []).map(target => target.expr);
  assert.ok(queries.some(expr => /playback_time_to_first_frame_seconds_bucket/.test(expr)));
  for (const expr of queries.filter(expr => /playback_(time_to_first_frame|seek_latency)_seconds_/.test(expr))) {
    assert.match(expr, /schema="latency-v3"/, 'never merge old histogram bucket schemas');
  }
  const jsonMetrics = await metrics.register.getMetricsAsJSON();
  for (const name of ['playback_time_to_first_frame_seconds', 'playback_seek_latency_seconds']) {
    const histogram = jsonMetrics.find(metric => metric.name === name);
    const buckets = histogram.values.filter(value => value.metricName === name + '_bucket');
    assert.ok(buckets.length > 0);
    assert.ok(buckets.every(value => value.labels.schema === metrics.LATENCY_SCHEMA));
    assert.ok(buckets.every(value => value.labels.generation === metrics.METRICS_GENERATION));
    const groups = Map.groupBy(buckets, value => value.labels.source_type || value.labels.method);
    for (const group of groups.values()) {
      for (let i = 1; i < group.length; i++) assert.ok(group[i].value >= group[i - 1].value, 'cumulative buckets stay monotonic within a worker/mode');
    }
    assert.equal(groups.size, 4, 'zero series are exposed before the first client frame');
  }

  assert.ok(queries.some(expr => /up\{job="cinevn",site="lan"\}/.test(expr)), 'show ingestion health separately from absent viewing events');
});
test('metrics endpoint is private even when the trusted proxy supplies a public client IP', async () => {
  const {default:express}=await import('express');
  const app=express();app.set('trust proxy',1);metrics.metricsMiddleware(app);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}/metrics`;
  try {
    const local=await fetch(url);assert.equal(local.status,200);assert.match(await local.text(),/process_cpu_user_seconds_total/);
    assert.equal((await fetch(url,{headers:{'X-Forwarded-For':'203.0.113.10'}})).status,404);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test.after(async()=>{cacheClient.disconnect();await fs.rm(scratch,{recursive:true,force:true});});
