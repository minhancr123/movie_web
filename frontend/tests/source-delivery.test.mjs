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
