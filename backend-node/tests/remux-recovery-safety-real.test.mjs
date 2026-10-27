// Mandatory media integration: missing FFmpeg/ffprobe is a failure, not a skip.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import http from 'node:http';
for(const bin of ['ffmpeg','ffprobe']) assert.equal(spawnSync(bin,['-version'],{stdio:'ignore'}).status,0,`${bin} is REQUIRED`);
const root=await fs.mkdtemp(path.join(os.tmpdir(),'cinevn-recovery-audit-'));
process.env.TRANSCODE_ROOT=root;process.env.REDIS_HOST='127.0.0.1';process.env.REDIS_PORT='1';
const {respawnSessionWriter,startRemuxSession}=await import('../services/playback/remuxService.js');
let writer,server;
const run=(bin,args)=>{const result=spawnSync(bin,args,{encoding:'utf8',timeout:20000});assert.equal(result.status,0,result.stderr?.slice(-1800));return result;};
const digest=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
try {
 const source=path.join(root,'synthetic.mp4');
 run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','8','-c:v','libx264','-threads','1','-g','24','-c:a','aac',source]);
 const id='a'.repeat(32),dir=path.join(root,id);await fs.mkdir(dir);
 const manifest=path.join(dir,'index.m3u8');
 writer=spawn('ffmpeg',['-v','error','-re','-i',source,'-c','copy','-f','hls','-hls_time','1','-hls_segment_type','fmp4','-hls_playlist_type','event','-hls_flags','independent_segments','-hls_segment_filename',path.join(dir,'seg_%05d.m4s'),manifest],{stdio:'ignore'});
 let text='';const deadline=Date.now()+10000;
 while(Date.now()<deadline){text=await fs.readFile(manifest,'utf8').catch(()=>'');if((text.match(/#EXTINF/g)||[]).length>=2)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(text.includes('#EXTINF'),'writer published a real prefix');
 const exited=new Promise(r=>writer.once('exit',r));writer.kill('SIGKILL');await exited;
 text=await fs.readFile(manifest,'utf8');assert.ok(!text.includes('#EXT-X-ENDLIST'));
 const files=(await fs.readdir(dir)).filter(n=>!n.endsWith('.tmp'));
 const hashes=Object.fromEntries(await Promise.all(files.map(async n=>[n,await digest(path.join(dir,n))])));
 const results=await Promise.all([respawnSessionWriter({sessionId:id,inputUrl:source}),respawnSessionWriter({sessionId:id,inputUrl:source})]);
 assert.ok(results.every(r=>r.reason==='new-session-required'&&!r.respawned));
 await assert.rejects(startRemuxSession({sessionId:id,inputUrl:source,resumeStartNumber:2}),{code:'UNSAFE_REMUX_RESUME'});
 await assert.rejects(startRemuxSession({sessionId:id,inputUrl:source,writerMode:'resume'}),{code:'UNSAFE_REMUX_RESUME'});
 await assert.rejects(startRemuxSession({sessionId:id,inputUrl:source,video:{mode:'copy',codec:'h264'},durationSeconds:8,windowSeconds:8}),{code:'EEXIST'});
 for(const n of files)assert.equal(await digest(path.join(dir,n)),hashes[n],n+' immutable');
 server=http.createServer(async(req,res)=>{try{res.end(await fs.readFile(path.join(dir,path.basename(req.url))))}catch{res.writeHead(404);res.end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 for(const n of files){const res=await fetch(`http://127.0.0.1:${server.address().port}/${n}`);assert.equal(res.status,200);await res.arrayBuffer();}
 // Decode the retained prefix as finite VOD in a separate test-only manifest.
 const finite=path.join(dir,'fixture-finite.m3u8');await fs.writeFile(finite,text+'\n#EXT-X-ENDLIST\n');
 const before=JSON.parse(run('ffprobe',['-v','error','-show_streams','-of','json',finite]).stdout);
 assert.ok(before.streams.some(s=>s.codec_type==='video'));assert.ok(before.streams.some(s=>s.codec_type==='audio'));
 run('ffmpeg',['-v','error','-i',finite,'-f','null','-']);
 // Safe recovery is a distinct namespace, with new init and local timestamps.
 const fresh=path.join(root,'fresh');await fs.mkdir(fresh);
 const next=path.join(fresh,'index.m3u8');
 run('ffmpeg',['-v','error','-ss','2','-i',source,'-c','copy','-f','hls','-hls_time','1','-hls_segment_type','fmp4','-hls_playlist_type','event',next]);
 run('ffmpeg',['-v','error','-i',next,'-f','null','-']);
 assert.ok((await fs.readFile(next,'utf8')).includes('#EXT-X-ENDLIST'));
 assert.equal((await respawnSessionWriter({sessionId:'fresh',inputUrl:source})).respawned,false);
 console.log(JSON.stringify({result:'PASS',segments:files.filter(n=>n.endsWith('.m4s')).length,concurrentRecoveryWriters:0,retainedPrefixDecode:true,freshSessionDecode:true}));
} finally {if(writer?.exitCode===null)writer.kill('SIGKILL');if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await fs.rm(root,{recursive:true,force:true});}
process.exit(0);
