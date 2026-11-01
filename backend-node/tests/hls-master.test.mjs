import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { outputCodec, buildMasterPlaylist } from '../services/playback/hlsMaster.js';
const dump = bytes => `\n00000000: ${Buffer.from(bytes).toString('hex').match(/.{1,4}/g).join(' ')}  ....\n`;
test('codec strings preserve actual AVC profile compatibility and level', () => {
  assert.equal(outputCodec({codec_name:'h264', codec_tag_string:'avc1', extradata:dump([1,66,192,31])}), 'avc1.42c01f');
  assert.throws(() => outputCodec({codec_name:'h264',codec_tag_string:'avc1'}));
});
test('HEVC uses actual level, tier, compatibility flags and constraints', () => {
  const bytes = Buffer.alloc(23); bytes[0]=1; bytes[1]=2; bytes[2]=32; bytes[6]=176; bytes[12]=153;
  assert.equal(outputCodec({codec_name:'hevc',codec_tag_string:'hvc1',extradata:dump(bytes)}), 'hvc1.2.4.L153.B0');
  bytes[1]=33;
  assert.equal(outputCodec({codec_name:'hevc',codec_tag_string:'hev1',extradata:dump(bytes)}), 'hev1.1.4.H153.B0');
});
test('AAC object type comes from output AudioSpecificConfig', () => {
  assert.equal(outputCodec({codec_name:'aac',codec_tag_string:'mp4a',extradata:dump([0x11,0x90])}), 'mp4a.40.2');
});
test('real fMP4 output: actual aspect ratio, measured bitrate, no master file required', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cinevn-master-'));
  try {
    const result=spawnSync(process.env.FFMPEG_BIN || 'ffmpeg', ['-hide_banner','-loglevel','error',
      '-f','lavfi','-i','color=black:s=192x80:r=24','-f','lavfi','-i','sine=sample_rate=48000',
      '-t','2','-c:v','libx264','-threads','1','-g','24','-c:a','aac','-f','hls',
      '-hls_time','1','-hls_segment_type','fmp4','-hls_list_size','0',
      '-hls_segment_filename',path.join(dir,'seg_%05d.m4s'),path.join(dir,'index.m3u8')],{timeout:30000,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr || result.error?.message);
    const master=await buildMasterPlaylist({playlistPath:path.join(dir,'index.m3u8'),indexUrl:'index.m3u8?media_grant=scoped&start=1'});
    assert.match(master,/RESOLUTION=192x80/);
    assert.match(master,/CODECS="avc1\.[0-9a-f]{6},mp4a\.40\.2"/);
    assert.match(master,/BANDWIDTH=[1-9]\d*/);
    assert(master.endsWith('index.m3u8?media_grant=scoped&start=1\n'));
    await assert.rejects(fs.stat(path.join(dir,'master.m3u8')),{code:'ENOENT'});
    await fs.rm(path.join(dir,'init.mp4'));
    await assert.rejects(buildMasterPlaylist({playlistPath:path.join(dir,'index.m3u8'),indexUrl:'index.m3u8'}),{code:'ENOENT'});
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('copied AVC TS has correct master metadata, preserves frames, and publishes without an init file', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cinevn-avc-ts-'));
  process.env.TRANSCODE_ROOT=path.join(dir,'sessions');process.env.RENDITIONS_ROOT=path.join(dir,'renditions');
  const {buildFfmpegArgs,sessionPath}=await import('../services/playback/remuxService.js');
  const {publishRendition,renditionPath}=await import('../services/playback/renditions.js');
  const run=(args)=>{const r=spawnSync('ffmpeg',['-v','error',...args],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);return r.stdout;};
  try {
    const source=path.join(dir,'source.mkv'),sid='e'.repeat(32),rid='f'.repeat(32),out=path.dirname(sessionPath(sid));await fs.mkdir(out,{recursive:true});
    run(['-f','lavfi','-i','testsrc2=size=192x80:rate=24','-f','lavfi','-i','sine=sample_rate=48000','-t','3',
      '-c:v','libx264','-threads','1','-g','24','-c:a','aac',source]);
    const args=buildFfmpegArgs({inputUrl:source,outputDir:out,readRate:0,video:{mode:'copy',codec:'h264'},audioCopy:true});
    assert.equal(args[args.indexOf('-hls_segment_type')+1],'mpegts');
    assert(!args.includes('independent_segments'),'copied open GOPs are not advertised as independently decodable');run(args);
    const master=await buildMasterPlaylist({playlistPath:path.join(out,'index.m3u8'),indexUrl:'index.m3u8'});
    assert.match(master,/RESOLUTION=192x80,CODECS="avc1\.[0-9a-f]{6},mp4a\.40\.2"/);
    assert(!await fs.stat(path.join(out,'init.mp4')).then(()=>true,()=>false));
    const hashes=p=>run(['-i',p,'-map','0:v:0','-f','framemd5','-']).split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(',').at(-1).trim());
    assert.deepEqual(hashes(path.join(out,'index.m3u8')),hashes(source),'compressed video is copied without picture loss');
    const result=await publishRendition({sessionId:sid,renditionId:rid});assert.equal(result.ok,true);
    assert.match(await fs.readFile(renditionPath(rid,'index.m3u8'),'utf8'),/seg_\d+\.ts/);
    const legacy=buildFfmpegArgs({inputUrl:source,outputDir:out,readRate:0,video:{mode:'copy',codec:'hevc'}});
    assert.equal(legacy[legacy.indexOf('-hls_segment_type')+1],'fmp4','HEVC container stays unchanged');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
