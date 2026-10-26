import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import { createRequire } from 'node:module';
const ctx={exports:{},require:createRequire(new URL('../package.json',import.meta.url))};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/display-text.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,ctx);
const {commentText,formatRuntimeMinutes}=ctx.exports;
test('comments decode legacy entities, remove markup and preserve readable text',()=>{
 assert.equal(commentText('&lt;p&gt;Phim &amp; nhạc&lt;br&gt;Rất hay!&lt;/p&gt;'),'Phim & nhạc\nRất hay!');
 assert.equal(commentText('&amp;lt;b&amp;gt;Hay&amp;lt;/b&amp;gt;'),'Hay');
 assert.equal(commentText('<script>alert(1)</script><img src=x onerror=alert(1)>Tốt'),'Tốt');
 assert.equal(commentText('1 < 2 và 3 > 2'),'1 < 2 và 3 > 2');
 assert.equal(commentText('&#272;&#7865;p &quot;quá&quot;'),'Đẹp "quá"');
});
test('film runtime uses hours and remaining minutes, with sensible short/unknown values',()=>{
 assert.equal(formatRuntimeMinutes(157),'2 giờ 37 phút');assert.equal(formatRuntimeMinutes(120),'2 giờ');
 assert.equal(formatRuntimeMinutes(45),'45 phút');assert.equal(formatRuntimeMinutes(null),'Đang cập nhật');
});
