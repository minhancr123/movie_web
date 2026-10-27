import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ctx = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/subtitle-alignment.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, ctx);
const { measureSubtitleAlignment: measure, alignedSubtitleTime: lookup, subtitleMappingFromMeasurements: mapping } = ctx.exports;
let at = 90;
const cues = Array.from({ length: 1000 }, (_, i) => {
  at += 7 + ((i * i * 17 + i * 31) % 113) / 10;
  return { start: at, end: at + 1.5, text: `cue ${i}` };
});
const shifted = (items, amount) => items.map(c => ({ ...c, start: c.start + amount, end: c.end + amount }));

test('both early and late external timestamps are corrected in the right direction', () => {
  const reference = cues.slice(0, 30);
  for (const offset of [-3, 3]) {
    const target = shifted(reference, offset);
    const result = measure(target, reference, { coverageRanges: [[80, 600]] });
    assert.equal(result.confident, true);
    assert.ok(Math.abs(result.offset - offset) < 0.001);
    const time = reference[10].start;
    assert.ok(Math.abs(lookup(time, mapping(null, result)) - target[10].start) < 0.001);
  }
});
test('full film versus embedded window scores only the covered dialogue', () => {
  const reference = cues.filter(c => c.start >= 120 && c.start < 420);
  const result = measure(cues, reference, { coverageRanges: [[120, 420]] });
  assert.equal(result.confident, true);
  assert.equal(result.matchRate, 1);
  assert.equal(result.samples, reference.length);
  assert.equal(result.offset, 0);
});
test('quiet gaps and unextracted coverage do not count as mismatched dialogue', () => {
  const reference = cues.filter(c => c.start < 180 || c.start >= 300 && c.start < 420);
  const result = measure(cues, reference, { coverageRanges: [[90, 180], [300, 420]] });
  assert.equal(result.matchRate, 1);
  assert.equal(result.samples, reference.length);
});
test('periodic or sparse matches never trigger an automatic correction', () => {
  const periodic = Array.from({ length: 40 }, (_, i) => ({ start: 100 + i * 5, end: 101 + i * 5, text: 'x' }));
  assert.equal(measure(periodic, periodic, { coverageRanges: [[90, 310]] }).confident, false);
  assert.equal(measure(cues.slice(0, 2), cues.slice(0, 2), {}), null);
});
test('drift mapping uses source-time anchors for either primary or secondary targets', () => {
  const previous = { confident: true, offset: -1, anchorT: 100 };
  const current = { confident: true, offset: -5, anchorT: 200 };
  const result = mapping(previous, current);
  assert.equal(result.slope, -0.04);
  assert.equal(lookup(200, result), 195);
  assert.equal(lookup(300, result), 291);
  assert.equal(mapping(previous, { ...current, confident: false }), null);
});

test('Vietnamese manual delay and drift never shift the independent English reference clock', () => {
  const clocks=ctx.exports.independentSubtitleTimes(300,3,0,{offset:-1.8,anchorT:100,slope:0.002},null);
  assert.equal(clocks.primary,301.6);
  assert.equal(clocks.secondary,300);
  assert.equal(ctx.exports.independentSubtitleTimes(300,-5,0.5,null,null).secondary,300.5);
});
test('short or incompatible cue grids do not certify a Vietnamese match', () => {
  const short=cues.slice(0,10);
  assert.equal(measure(short,short,{}).confident,false);
  const target=cues.slice(0,30).map(c=>({...c,end:c.end+3}));
  assert.equal(measure(target,cues.slice(0,30),{}).confident,false,'different cue durations are weak evidence');
});


test('external/external cue timing can prove ±10s; language text never supplies the match',()=>{
 const reference=cues.slice(0,60);
 for(const offset of [-10,10]){
  const target=shifted(reference,offset).map(c=>({...c,text:'bản dịch khác ngôn ngữ'}));
  const result=measure(target,reference,{});
  assert.equal(result.confident,true);assert.ok(Math.abs(result.offset-offset)<0.01);
 }
});
