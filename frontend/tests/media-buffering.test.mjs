import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync(new URL('../src/lib/media-buffering.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const deadlineFixture = () => {
  let now=0, serial=0;const pending=new Map(), slot={current:undefined};
  const ctx={exports:{},setTimeout:(fn,delay)=>{pending.set(++serial,{fn,at:now+delay});return serial;},clearTimeout:id=>pending.delete(id)};
  vm.runInNewContext(code,ctx);
  const tick=ms=>{const end=now+ms;for(;;){const next=[...pending].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;pending.delete(next[0]);next[1].fn();}now=end;};
  return {arm:(fn,delay,progressed=false)=>ctx.exports.armStallDeadline(slot,fn,delay,progressed),tick,
    clear:()=>{ctx.clearTimeout(slot.current);slot.current=undefined;},now:()=>now};
};
test('repeated waiting/canplay without progress cannot postpone recovery indefinitely',()=>{
  const f=deadlineFixture();let recoveries=0;const recover=()=>recoveries++;
  f.arm(recover,15000);
  for(let i=0;i<14;i++){f.tick(1000);f.arm(recover,15000);}
  assert.equal(recoveries,0);f.tick(1000);assert.equal(recoveries,1);
});
test('loader retry gets one bounded escalation even when readiness events continue',()=>{
  const f=deadlineFixture();const events=[];
  f.arm(()=>{events.push('local');f.arm(()=>events.push('parent'),25000,true);},15000);
  for(let i=0;i<39;i++){f.tick(1000);f.arm(()=>events.push('wrong'),15000);}
  assert.deepEqual(events,['local']);f.tick(1000);assert.deepEqual(events,['local','parent']);
});
test('real progress renews the deadline; pause/cleanup cancels it and resume arms anew',()=>{
  const f=deadlineFixture();let failures=0;const fail=()=>failures++;
  f.arm(fail,15000);f.tick(14000);assert.equal(f.arm(fail,15000,true),true);
  f.tick(14000);assert.equal(failures,0);f.clear();f.tick(30000);assert.equal(failures,0);
  f.arm(fail,15000);f.tick(15000);assert.equal(failures,1);
});
const fixture = () => {
  const pending = new Map(); let serial = 0;
  const ctx = { exports: {}, setTimeout: fn => { pending.set(++serial, fn); return serial; },
    clearTimeout: id => pending.delete(id) };
  vm.runInNewContext(code, ctx);
  const video = Object.assign(new EventTarget(), { paused: false, ended: false });
  let loading = false, restoring = false;
  const cleanup = ctx.exports.observeBuffering(video, value => { loading = value; }, () => restoring);
  return { video, cleanup, loading: () => loading, restoring: value => { restoring = value; },
    event: name => video.dispatchEvent(new Event(name)),
    tick: () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn()); } };
};
test('waiting then Safari pause before the delayed spinner cannot stick loading on a paused frame', () => {
  const f = fixture(); f.event('waiting'); f.video.paused = true; f.event('pause'); f.tick();
  assert.equal(f.loading(), false); f.cleanup();
});
test('pausing after buffering hides the spinner, but a restore pause keeps startup loading', () => {
  const f = fixture(); f.event('waiting'); f.tick(); assert.equal(f.loading(), true);
  f.video.paused = true; f.restoring(true); f.event('pause'); assert.equal(f.loading(), true);
  f.restoring(false); f.event('pause'); assert.equal(f.loading(), false); f.cleanup();
});
test('genuine waiting remains visible, clears on playback, and retired listeners cannot fire', () => {
  const f = fixture(); f.event('waiting'); f.tick(); assert.equal(f.loading(), true);
  f.event('playing'); assert.equal(f.loading(), false);
  f.event('waiting'); f.cleanup(); f.tick(); assert.equal(f.loading(), false);
  f.event('waiting'); f.tick(); assert.equal(f.loading(), false);
});
test('a silent OS pause is checked again when the waiting delay expires', () => {
  const f = fixture(); f.event('waiting'); f.video.paused = true; f.tick();
  assert.equal(f.loading(), false); f.cleanup();
});
