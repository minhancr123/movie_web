import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const out=mkdtempSync(path.join(tmpdir(),'episode-resume-'));
execFileSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'src/lib/episode-resume.ts','--outDir',out,'--module','commonjs','--target','es2020','--skipLibCheck'],{cwd:root});
const {episodeResumePosition,episodeResumeLabel,readEpisodeHistory}=await import(pathToFileURL(path.join(out,'episode-resume.js')));
process.on('exit',()=>rmSync(out,{recursive:true,force:true}));

test('asks about exactly the selected episode and season, without borrowing another episode playhead',()=>{
 const saved={currentEpisode:'s1e1',progress:400,duration:1372,episodeProgress:{s1e4:{progress:258.8,duration:1372}}};
 assert.equal(episodeResumePosition(saved,'s1e4'),258);
 assert.equal(episodeResumePosition(saved,'s1e2'),null);
 assert.equal(episodeResumePosition(saved,'s2e4'),null);
 assert.equal(episodeResumeLabel(258),'4:18');
});
test('supports older same-episode history but skips completed, invalid and barely-started episodes',()=>{
 assert.equal(episodeResumePosition({currentEpisode:'s1e4',progress:258,duration:1372},'s1e4'),258);
 for(const progress of [0,1,NaN,Infinity,-2,1345,1372,1500]) assert.equal(episodeResumePosition({episodeProgress:{s1e4:{progress,duration:1372}}},'s1e4'),null);
 assert.equal(episodeResumePosition({episodeProgress:{s1e4:{progress:258}}},'s1e4'),258);
 assert.equal(episodeResumePosition({episodeProgress:{s1e4:{progress:258}}},'s1e4',260),null);
 assert.equal(episodeResumePosition({episodeProgress:{s1e4:{progress:258,duration:Infinity}}},'s1e4',260),null);
 assert.equal(episodeResumePosition(undefined,'s1e4'),null);
});
test('reads the player latest saved position, tolerates blocked storage and respects removal',()=>{
 const fallback={currentEpisode:'s1e4',progress:50};
 assert.equal(readEpisodeHistory('series',fallback,()=>JSON.stringify([{slug:'series',currentEpisode:'s1e4',progress:258}])).progress,258);
 assert.equal(readEpisodeHistory('series',fallback,()=>{throw Error('blocked');}),fallback);
 assert.equal(readEpisodeHistory('series',fallback,()=>'{bad json'),fallback);
 assert.equal(readEpisodeHistory('series',fallback,()=>JSON.stringify([])),undefined);
 assert.equal(readEpisodeHistory('series',fallback,()=>JSON.stringify([{slug:'other',progress:258}])),undefined);
});
