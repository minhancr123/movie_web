import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const context={exports:{},Date};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/viewing-presence.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
const {observeViewing}=context.exports;
const fixture=()=>{let clock=1000,tick;const events=new Map(),sent=[];const video={paused:true,ended:false,seeking:false,currentTime:0,readyState:2,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const stop=observeViewing(video,r=>sent.push({...r}),{now:()=>clock,offset:()=>600,every:fn=>{tick=fn;return 1;},cancel:()=>{tick=null;}});
 return {video,sent,stop,emit:name=>events.get(name)?.({type:name}),advance:ms=>{clock+=ms;tick?.();},events};};
test('actual progress counts while readyState stays at 2; pause, waiting and resumed frames update status',()=>{
 const f=fixture();assert.equal(f.sent.at(-1).state,'paused');f.video.paused=false;f.video.currentTime=1;f.emit('timeupdate');assert.equal(f.sent.at(-1).state,'playing');assert.equal(f.sent.at(-1).position,601);
 f.emit('waiting');assert.equal(f.sent.at(-1).state,'buffering');f.video.currentTime=2;f.emit('timeupdate');assert.equal(f.sent.at(-1).state,'playing');
 f.video.paused=true;f.emit('pause');assert.equal(f.sent.at(-1).state,'paused');f.video.ended=true;f.emit('ended');assert.equal(f.sent.at(-1).state,'ended');f.stop();assert.equal(f.events.size,0);
});
test('an open but stalled video expires playing evidence and progress messages are bounded',()=>{
 const f=fixture();f.video.paused=false;f.emit('playing');const count=f.sent.length;for(let i=1;i<30;i++){f.video.currentTime=i/10;f.emit('timeupdate');}assert.equal(f.sent.length,count);
 f.advance(9000);assert.equal(f.sent.at(-1).state,'buffering');f.video.seeking=true;f.video.currentTime=100;f.emit('timeupdate');assert.equal(f.sent.at(-1).state,'buffering');f.stop();
});
