import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const load=(file,globals={})=>{const context={exports:{},setTimeout,clearTimeout,...globals};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(`../src/lib/${file}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);return context.exports;};
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
