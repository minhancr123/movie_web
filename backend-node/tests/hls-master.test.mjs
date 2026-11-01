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
