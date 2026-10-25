import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const available=spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status===0;
test('a queued real FFmpeg writer starts only after a reservation is freed and cancellation does not spawn', {skip:!available,timeout:20000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'queued-remux-'));
 process.env.TRANSCODE_ROOT=path.join(root,'transcodes');process.env.REMUX_MAX_WRITERS='1';
 const svc=await import('../services/playback/remuxService.js');
 const input=path.join(root,'sample.mp4');
 const gen=spawnSync('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=c=blue:s=160x90:r=10:d=8','-f','lavfi','-i','sine=frequency=440:duration=8','-c:v','libx264','-preset','ultrafast','-g','20','-pix_fmt','yuv420p','-c:a','aac','-shortest',input],{encoding:'utf8'});
 assert.equal(gen.status,0,gen.stderr);const hold=await svc.acquireWriterReservation();assert.equal(hold.admitted,true);
 const signal=new AbortController();let queued=false;
 const cancelled=svc.startRemuxSession({sessionId:'a'.repeat(32),inputUrl:input,video:{mode:'copy',codec:'h264',height:90,kbps:500},windowSeconds:8,durationSeconds:8,queue:{signal:signal.signal,onWait:()=>{queued=true;}}});
 const rejected=assert.rejects(cancelled,{code:'RESOLVE_SUPERSEDED'});await new Promise(r=>setTimeout(r,100));signal.abort();await rejected;
 assert.equal(queued,true);assert.equal(svc.activeWriterCount(),0);assert.equal(svc.reservedWriterCount(),1);
 let waiting=false;const pending=svc.startRemuxSession({sessionId:'b'.repeat(32),inputUrl:input,video:{mode:'copy',codec:'h264',height:90,kbps:500},windowSeconds:8,durationSeconds:8,queue:{onWait:()=>{waiting=true;}}});
 try {
  await new Promise(r=>setTimeout(r,100));assert.equal(svc.activeWriterCount(),0);
  svc.releaseWriterReservation(hold.reservationId);const session=await pending;
  assert.equal(waiting,true);assert.equal(svc.activeWriterCount(),1);
  const closed=new Promise(resolve=>session.process.once('close',resolve));await closed;
  const playlist=await fs.readFile(session.playlistPath,'utf8');assert.match(playlist,/#EXT-X-ENDLIST/);assert.match(playlist,/#EXTINF:/);
 } finally {svc.writerAdmissionQueue.close();svc.releaseWriterReservation(hold.reservationId);await svc.stopRemuxSession('b'.repeat(32));await fs.rm(root,{recursive:true,force:true});}
});
