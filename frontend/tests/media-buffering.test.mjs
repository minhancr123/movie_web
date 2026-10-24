import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync(new URL('../src/lib/media-buffering.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
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
