import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const ctx={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/source-delivery.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,ctx);const m=ctx.exports;
test('filters distinguish verified/likely direct from processing and unknown',()=>{
 const list=['verified','likely','remux','unknown'].map((directPlay,i)=>({directPlay,sourceToken:String(i)}));
 assert.equal(m.filterPlaybackSources(list,'direct').length,2);assert.equal(m.filterPlaybackSources(list,'remux').length,1);assert.equal(m.filterPlaybackSources(list,'all').length,4);
});
test('recovery uses a ready same-quality alternative and never repeats a failed source',()=>{
 const list=[{sourceToken:'failed',cached:true,resolution:1080,directPlay:'verified'},{sourceToken:'slow',cached:false,resolution:1080,directPlay:'likely'},{sourceToken:'too-large',cached:true,resolution:2160,directPlay:'verified'},{sourceToken:'safe',cached:true,resolution:1080,directPlay:'likely'}];
 assert.equal(m.pickFallbackSource(list,new Set(['failed']),1080).sourceToken,'safe');assert.equal(m.pickFallbackSource(list,new Set(list.map(s=>s.sourceToken))),undefined);
});

test('switching release resets audio indices; seeking and explicit track choices retain them',()=>{
 assert.equal(m.audioIndexForSource(undefined,2,'old','new'),null);
 assert.equal(m.audioIndexForSource(undefined,2,'same','same'),2);
 assert.equal(m.audioIndexForSource(1,2,'old','new'),1);
});

test('isSourceActiveToken matches exact, case-insensitive, and versioned index tags', () => {
 const hash = 'a'.repeat(40);
 assert.equal(m.isSourceActiveToken(hash, hash), true);
 assert.equal(m.isSourceActiveToken(hash.toUpperCase(), hash), true);
 assert.equal(m.isSourceActiveToken(`${hash}:index:0`, hash), true);
 assert.equal(m.isSourceActiveToken(hash, `${hash}:index:0`), true);
 assert.equal(m.isSourceActiveToken(`${hash}:index:1`, `${hash}:index:0`), true);
 assert.equal(m.isSourceActiveToken('vimo|movie|123', 'vimo|movie|123'), true);
 assert.equal(m.isSourceActiveToken('vimo|movie|123', 'vimo|movie|456'), false);
 assert.equal(m.isSourceActiveToken('b'.repeat(40), hash), false);
 assert.equal(m.isSourceActiveToken(undefined, hash), false);
});
test('file aliases match only the same index; provider types and episodes stay distinct', () => {
 const h='a'.repeat(40);
 assert.equal(m.isSourceActiveToken(`${h}:0`, `${h.toUpperCase()}:index:00`),true);
 assert.equal(m.isSourceActiveToken(`${h}:unknown:release.mkv`, `${h}:unknown:RELEASE.MKV`),true);
 assert.equal(m.isSourceActiveToken(`${h}:unknown:one.mkv`, `${h}:unknown:two.mkv`),false);
 assert.equal(m.isSourceActiveToken('vimo|movie|123','vimo|series|123'),false);
 assert.equal(m.isSourceActiveToken('vimo|series|123:1:1','vimo|series|123:1:2'),false);
 assert.equal(m.isSourceActiveToken('yastream:ABC','yastream:abc'),false);
});
test('the active row is unique for pack files and duplicate aliases', () => {
 const h='a'.repeat(40), a={sourceToken:`${h}:index:0`}, b={sourceToken:`${h}:index:1`}, alias={sourceToken:`${h}:1`};
 const rows=[a,b,alias];const active=m.findPlayingSource(rows,`${h}:index:1`);
 assert.equal(active,b);assert.equal(rows.filter(row=>row===active).length,1);
 assert.equal(m.findPlayingSource(rows,h),undefined,'a bare hash cannot identify which pack file is playing');
 assert.equal(m.findPlayingSource([{sourceToken:'bad',playable:false}], 'bad'),undefined);
});
test('server identity wins over a stale manual pin, including corrected file indices', () => {
 const h='a'.repeat(40);
 assert.equal(m.resolvedPlayingToken(`${h}:index:1`,`${h}:index:0`),`${h}:index:1`);
 assert.equal(m.resolvedPlayingToken('vimo|movie|12',h),'vimo|movie|12');
 assert.equal(m.resolvedPlayingToken(undefined,h),h);assert.equal(m.resolvedPlayingToken(undefined), '');
});
test('VIP numbers follow the complete sorted group, not raw order or the current filter', () => {
 const c={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/source-groups.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,c);
 const g=c.exports;
 const a={sourceToken:'a',resolution:1080,directPlay:'verified'}, b={sourceToken:'b',resolution:1080,hasViSub:true,directPlay:'remux'}, v={sourceToken:'vimo|movie|123',origin:'vimo'};
 const all=[a,b,v],groups=g.groupPlaybackSources(all);
 assert.equal(g.sourceOrdinal(groups,b),1);assert.equal(g.sourceOrdinal(groups,a),2);assert.equal(g.sourceOrdinal(groups,v),1);
 const filtered=m.filterPlaybackSources(all,'direct');assert.equal(filtered.length,2);
 assert.equal(g.sourceOrdinal(groups,filtered.find(s=>s.sourceToken==='a')),2,'hiding VIP 1 must not relabel VIP 2');
});

test('prewarm reads the exact movie or complete episode pin and survives blocked storage', () => {
 const keys=[];const read=key=>{keys.push(key);return 'selected-file';};
 assert.equal(m.prewarmSourceToken(read,'movie',299534), 'selected-file');
 assert.equal(keys.pop(),'playback:selectedSource:movie:299534:movie:full');
 assert.equal(m.prewarmSourceToken(read,'tv',1396,2,8),'selected-file');
 assert.equal(keys.pop(),'playback:selectedSource:tv:1396:2:8');
 assert.equal(m.prewarmSourceToken(read,'tv',1396,2),undefined);assert.equal(keys.length,0);
 assert.equal(m.prewarmSourceToken(()=>{throw Error('blocked');},'movie',1),undefined);
 assert.equal(m.prewarmSourceToken(()=>null,'movie',1),undefined);
});
