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

test('native decode and unsupported errors switch source, network/abort errors do not', () => {
 for (const code of [3, 4]) assert.equal(m.nativeMediaNeedsAnotherSource(code), true);
 for (const code of [undefined, 0, 1, 2]) assert.equal(m.nativeMediaNeedsAnotherSource(code), false);
});

test('a failed file cannot reappear through a versioned source token', () => {
 const hash='a'.repeat(40);
 const list=[{sourceToken:hash+':index:7',cached:true,resolution:1080},{sourceToken:'other',cached:true,resolution:1080}];
 assert.equal(m.pickFallbackSource(list,new Set([hash]),1080).sourceToken,'other');
});

test('decode failover prefers a ready alternate codec without upscaling or repeating failed bytes', () => {
 const list = [
  { sourceToken:'bad', cached:true, resolution:1080, codec:'HEVC' },
  { sourceToken:'same-codec', cached:true, resolution:1080, filename:'Film.x265.mkv' },
  { sourceToken:'compatible', cached:true, resolution:1080, filename:'Film.1080p.x264.mkv' },
  { sourceToken:'oversized', cached:true, resolution:2160, codec:'H.264' },
  { sourceToken:'uncached', cached:false, resolution:1080, codec:'AVC' },
 ];
 assert.equal(m.sourceCodecFamily(list[1]), 'hevc');
 assert.equal(m.pickFallbackSource(list, new Set(['bad']), 1080, 'hevc').sourceToken, 'compatible');
 assert.equal(m.pickFallbackSource(list, new Set(['bad','compatible']), 1080, 'hevc').sourceToken, 'same-codec');
 assert.equal(m.pickFallbackSource(list, new Set(['bad','same-codec','compatible','oversized','uncached']), 1080, 'hevc'), undefined);
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
