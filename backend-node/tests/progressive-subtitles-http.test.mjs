import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { registerHooks } from 'node:module';
import express from 'express';
import jwt from 'jsonwebtoken';

test('authenticated HTTP publishes cached English and fast Vietnamese before a blocked provider, with legacy compatibility', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'cinevn-progressive-http-'));
  process.env.SUBS_ROOT = root;
  process.env.STREMIO_SUBTITLE_ADDONS = 'https://8.8.8.8/fast,https://8.8.8.8/slow';
  process.env.OPENSUBTITLES_API_KEY = '';
  process.env.JWT_SECRET = 'isolated-progressive-test-signing-key';
  const owner='a'.repeat(24), foreign='b'.repeat(24), hash='c'.repeat(40), sid='d'.repeat(32);
  const cache = new Map();
  globalThis.__subtitleHttpCache = cache;
  globalThis.__subtitleHttpDB = { collection: name => ({
    findOne: async () => name === 'users' ? { isBanned:false } : { sessionId:sid, infoHash:hash, fileId:7, userIdStr:owner, sourceFileName:'Fixture.1080p.mkv', durationSeconds:400 },
    find: () => ({sort:()=>({toArray:async()=>[]})}),
  }) };
  const dataURL = source => 'data:text/javascript,'+encodeURIComponent(source);
  const hooks = registerHooks({resolve(specifier,context,next) {
    if (specifier.endsWith('/config/database.js')) return {shortCircuit:true,url:dataURL('export const getDB=()=>globalThis.__subtitleHttpDB; export const connectDB=async()=>getDB(); export default {};')};
    if (specifier.endsWith('/config/redis.js')) return {shortCircuit:true,url:dataURL(`
      export const CACHE_TTL={DETAIL:60};export const cacheClient={disconnect(){},on(){},get:async()=>null};
      export const getCache=async k=>globalThis.__subtitleHttpCache.get(k)||null;
      export const setCache=async(k,v)=>{globalThis.__subtitleHttpCache.set(k,v);};
      export const cachedIn=async(store,k,ttl,fn)=>{const old=await store.getCache(k);if(old)return old;const v=await fn();await store.setCache(k,v,ttl);return v;};
      export const cached=(k,ttl,fn)=>cachedIn({getCache,setCache},k,ttl,fn);
    `)};
    return next(specifier,context);
  }});
  t.after(()=>{hooks.deregister();delete globalThis.__subtitleHttpCache;delete globalThis.__subtitleHttpDB;});
  const {fileIdentity}=await import('../services/playback/fileSelection.js');
  const {subtitleSidecarName,withSubtitleCoverage}=await import('../services/playback/subtitleInventory.js');
  cache.set('catalog:detail:movie:157336:v3',{title:'Fixture',imdbId:'tt0001573',year:2026});
  cache.set(`playback:probe:v3:${fileIdentity(hash,7)}`,{audio:[],subtitles:[{codec:'subrip',language:'eng',streamIndex:2}]});
  const vtt='WEBVTT\n\n00:00:00.100 --> 00:00:01.000\nOne\n\n00:00:01.100 --> 00:00:02.000\nTwo\n\n00:00:02.100 --> 00:00:03.000\nThree\n';
  await fs.writeFile(path.join(root,subtitleSidecarName(fileIdentity(hash,7),0,{startAt:0,durationSeconds:300})),withSubtitleCoverage(vtt,[[0,300]]));
  let releaseSlow;const gate=new Promise(r=>{releaseSlow=r;});let slowReached=false;
  const provider=http.createServer(async(req,res)=>{
    if(req.url.startsWith('/slow/')) {slowReached=true;await gate;if(!res.destroyed)res.end(JSON.stringify({subtitles:[]}));return;}
    if(req.url.startsWith('/fast/')) {res.end(JSON.stringify({subtitles:[{id:'vi',lang:'vie',url:'https://8.8.8.8/subtitle.vtt',name:'Fixture.1080p'}]}));return;}
    res.end(vtt.replace('One','Xin chào').replace('Two','Chúng ta đi thôi').replace('Three','Hẹn gặp lại'));
  });
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));
  const original=http.request;
  // The production DNS/SSRF policy still validates a public IP. Only the test
  // transport is redirected to loopback, never a production allowlist bypass.
  for(const transport of [http,https])t.mock.method(transport,'request',(options,callback)=>{
    assert.equal(options.host,'8.8.8.8');
    return original({...options,host:'127.0.0.1',port:provider.address().port},callback);
  });
  const c=await import('../controllers/playbackController.js');
  const {authMiddleware}=await import('../middleware/auth.js');
  const app=express();app.use(express.json());app.use(authMiddleware);
  app.post('/inventory',c.getProgressiveSubtitleInventory);app.get('/job/:jobId',c.getSubtitleJob);
  app.delete('/job/:jobId',c.cancelSubtitleInventory);app.post('/legacy',c.getPlaybackSubtitles);
  const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{releaseSlow();provider.closeAllConnections();server.closeAllConnections();provider.close();server.close();await fs.rm(root,{recursive:true,force:true});});
  const token=id=>jwt.sign({userId:id},process.env.JWT_SECRET);
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(route,method='GET',body,who=owner)=>fetch(base+route,{method,headers:{Authorization:'Bearer '+token(who),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const body={type:'movie',tmdbId:157336,sourceToken:hash,playbackSessionId:sid,positionSeconds:0,externalOnly:false};
  const begin=await request('/inventory','POST',body);assert.equal(begin.status,200);
  assert.equal(begin.headers.get('cache-control'),'private, no-store');
  const id=(await begin.json()).data.jobId;
  let partial;const until=Date.now()+4000;
  while(Date.now()<until){partial=(await (await request('/job/'+id)).json()).data;if(partial?.tracks?.some(x=>x.language==='vie')&&partial.tracks.some(x=>x.source==='embedded'))break;await new Promise(r=>setTimeout(r,20));}
  assert.ok(slowReached);assert.equal(partial.done,false,'blocked provider must still be pending');
  assert.ok(partial.tracks.some(x=>x.source==='embedded'&&x.ready));
  assert.ok(partial.tracks.some(x=>x.language==='vie'&&x.ready),'fast provider publishes before slow provider finishes');
  assert.equal((await request('/job/'+id,'GET',null,foreign)).status,404);
  assert.equal((await request('/job/'+id,'DELETE',null,foreign)).status,404);
  releaseSlow();
  let final;
  for(let i=0;i<100;i++){final=(await(await request('/job/'+id)).json()).data;if(final.done)break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(final.done,true);assert.ok(final.tracks.length>=2);
  const legacy=await request('/legacy','POST',{...body,externalOnly:true});
  assert.equal(legacy.status,200);const old=(await legacy.json()).data;
  assert.equal(old.kind,undefined);assert.ok(old.tracks.length>=2);
  assert.equal((await request('/job/'+id,'DELETE')).status,204);
  const retired=(await(await request('/job/'+id)).json()).data;assert.equal(retired.cancelled,true);
});
