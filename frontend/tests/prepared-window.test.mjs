import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const ctx={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/prepared-window.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,ctx);
const {prepareWindowAt,preparedWindowCovers,restoreRequestedPosition,preparationMatches}=ctx.exports;
test('prepares near the planned edge, never the growing prefix or final film edge',()=>{
 assert.equal(prepareWindowAt(900,25,7200,600),null);
 assert.equal(prepareWindowAt(900,570,7200,600),1499);
 assert.equal(prepareWindowAt(900,575,7200,600,602.4),1501.4);
 assert.equal(prepareWindowAt(6600,570,7200,600),null);
 assert.equal(prepareWindowAt(0,20,7200,0),null);
});
test('prepared coverage accepts the real boundary despite bucket/overlap differences',()=>{
 assert.equal(preparedWindowCovers({startOffset:1496,windowSeconds:600},1502.4),true);
 assert.equal(preparedWindowCovers({startOffset:900,windowSeconds:600},1502.4),false,'old ending window is not its successor');
 assert.equal(preparedWindowCovers({startOffset:1496,windowSeconds:600},1400),false);
 assert.equal(preparedWindowCovers({startOffset:7100,windowSeconds:100,durationSeconds:7200},7198.5),true);
 assert.equal(preparedWindowCovers({startOffset:7100,windowSeconds:100,durationSeconds:7200},7201),false);
});
test('restores the exact fractional intent, not the integer decode bucket',()=>{
 assert.equal(restoreRequestedPosition(1502,1502.4),1502.4);
 assert.equal(restoreRequestedPosition(undefined,1502.4),1502.4);
 assert.equal(restoreRequestedPosition(300,0),300);
});

test('short high-bitrate windows prepare early and retain matching work at their boundary',()=>{
 assert.equal(prepareWindowAt(0,80,2700,122),121);
 assert.equal(preparationMatches({at:121,token:'a',audio:0},122.2,'a',0),true);
 assert.equal(preparationMatches({at:121,token:'a',audio:0},300,'a',0),false);
 assert.equal(preparationMatches({at:121,token:'a',audio:0},122,'b',0),false);
 assert.equal(preparationMatches({at:121,token:'a',audio:0},122,'a',1),false);
});
