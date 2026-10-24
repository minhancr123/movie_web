import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ctx={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/auth-request-context.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,ctx);
const {authRequestHeaders}=ctx.exports;
test('NextAuth forwards only request IP and UA, never cookies or bearer credentials',()=>{
 const result=authRequestHeaders(new Headers({'x-forwarded-for':'198.51.100.8, 127.0.0.1','user-agent':'Test Phone','cookie':'secret','authorization':'Bearer secret','x-real-ip':'1.2.3.4'}));
 assert.equal(result['X-Forwarded-For'],'198.51.100.8');assert.equal(result['User-Agent'],'Test Phone');assert.equal(Object.keys(result).length,2);
});
test('missing or malformed proxy metadata is left unknown rather than invented',()=>{
 assert.equal(Object.keys(authRequestHeaders(new Headers())).length,0);
 assert.equal(authRequestHeaders(new Headers({'x-forwarded-for':'unknown host'}))['X-Forwarded-For'],undefined);
});
