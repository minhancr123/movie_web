import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const load=(file,globals={})=>{const context={exports:{},setTimeout,clearTimeout,...globals};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(`../src/lib/${file}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);return context.exports;};
test('native HLS start hint uses the local clock and preserves grants without changing direct URLs',()=>{
 const {withNativeStartHint}=load('mediaPipeline',{URL});
 const src='/api/playback/hls/abc/index.m3u8?media_grant=G&start=9';
 const hinted=new URL(withNativeStartHint(src,6.16),'https://cinevn.me');
 assert.equal(hinted.searchParams.get('start'),'6.16');
 assert.equal(hinted.searchParams.get('media_grant'),'G');
 assert.equal(hinted.searchParams.getAll('start').length,1);
 const absolute='https://cinevn.me/api/playback/hls/r/abc/index.m3u8?access_token=a%2Bb#anchor';
 const next=new URL(withNativeStartHint(absolute,19.183));
 assert.equal(next.origin,'https://cinevn.me');
 assert.equal(next.searchParams.get('access_token'),'a+b');
 assert.equal(next.hash,'#anchor');
 assert.equal(withNativeStartHint('//cinevn.me/api/playback/hls/r/abc/index.m3u8',12),
  '//cinevn.me/api/playback/hls/r/abc/index.m3u8?start=12');
 for(const at of [0,-1,NaN,Infinity])assert.equal(withNativeStartHint(src,at),src);
 for(const other of ['https://cdn.example/movie.mp4','https://cdn.example/stream.m3u8'])assert.equal(withNativeStartHint(other,12),other);
});
test('Apple mobile and desktop Safari prefer native HLS; other desktops keep MSE sampling',()=>{
 const {prefersNativeHls,isTaintFreePipeline}=load('mediaPipeline');
 assert.equal(prefersNativeHls('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'),true);
 assert.equal(prefersNativeHls('Mozilla/5.0 (Macintosh)','MacIntel',5),true,'iPad desktop UA');
 assert.equal(prefersNativeHls('Mozilla/5.0 (Macintosh)','MacIntel',0),false);
 const safari='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
 assert.equal(prefersNativeHls(safari,'MacIntel',0),true,'Safari must use its native HEVC pipeline even when MSE is present');
 for (const brand of ['Chrome/140.0.0.0','Chromium/140.0.0.0','Edg/140.0.0.0','OPR/120.0']) {
  assert.equal(prefersNativeHls(safari+' '+brand,'MacIntel',0),false,brand+' must retain the MSE path');
 }
 assert.equal(prefersNativeHls('Mozilla/5.0 (Linux; Android 14)'),false);
 assert.equal(isTaintFreePipeline('/movie.m3u8',true,true),false,'native must never connect pixel/WebAudio sampling');
 assert.equal(isTaintFreePipeline('/movie.m3u8',true,false),true);
});
test('clock separates startup, seek, paused time and actual rebuffering',()=>{
  let now=1000;const events=[];const {PlaybackClock}=load('playback-telemetry');
  const c=new PlaybackClock(()=>now,e=>events.push(e),0);
  now=2000;c.wait();now=3000;c.frame();
  now=5000;c.wait();now=6000;c.frame();
  now=8000;c.pause();now=18000;c.seek();now=20000;c.frame();
  now=22000;c.flush();c.error();c.error();
  assert.equal(events.filter(e=>e.type==='first_frame').length,1);
  assert.equal(events.find(e=>e.type==='first_frame').seconds,3);
  assert.equal(events.find(e=>e.type==='seek').seconds,2);
  assert.equal(events.find(e=>e.type==='summary').playedSeconds,6);
  assert.equal(events.find(e=>e.type==='summary').stalledSeconds,1);
  assert.equal(events.filter(e=>e.type==='error').length,1);
});
test('capability hints call the browser decoder API; absence never claims measured smoothness',async()=>{
 const globals={window:{screen:{width:1920,height:1080},devicePixelRatio:1,matchMedia:()=>({matches:false})},document:{createElement:()=>({canPlayType:()=>''})},navigator:{}};
 const absent=load('capabilities',globals);
 assert.equal(absent.detectCapabilities().smoothMaxHeight,0);
 assert.equal(absent.detectCapabilities().decodingSmooth,false);
 let calls=0;const caps=load('capabilities',{...globals,navigator:{mediaCapabilities:{decodingInfo:async()=>{calls++;return{supported:true,smooth:true,powerEfficient:true};}}}});
 const result=await caps.getDevicePlaybackCapabilities();assert(calls>0);assert.equal(result.smoothMaxHeight,1080);assert.equal(result.decodingSmooth,true);
});

test('seek trace is bounded, resets latest intent and never invents native frame/network phases',()=>{
 let now=0;const {SeekTrace}=load('seek-trace');const trace=new SeekTrace(()=>now);
 trace.begin();now=5;trace.mark('seek_commit');now=25;trace.mark('resolve_start');
 trace.begin();now=50;trace.mark('target_decode_ready');
 const result=trace.finish();assert.equal(result.seek_intent,0);assert.equal(result.target_decode_ready,25);
 assert.equal(result.resolve_start,undefined);assert.equal(result.first_target_frame_rendered,undefined);
 assert.equal(trace.finish(),null);
});
