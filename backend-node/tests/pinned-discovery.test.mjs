import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinnedDiscoveryResolver, candidatesForPin, reusableSourceFile, pinnedDiscoveryScope } from '../services/playback/pinnedDiscovery.js';
const h = 'a'.repeat(40);
const identityOf = c => `${c.infoHash}:index:${c.fileIdx}`;
const matches = (c, token) => token === c.infoHash || token === identityOf(c);
const scopeOf = p => JSON.stringify([p.credential,p.profile,p.movie,p.episode]);
const source = (index=0) => ({infoHash:h,fileIdx:index,filename:`episode-${index}.mkv`,cached:true});
const context = {credential:'private-account-a',profile:'config-a',movie:1,episode:2};

test('production scope hashes credentials and isolates addon config and episode context', () => {
  const p={debridKey:'private-key',imdbId:'tt1',mediaType:'tv',season:1,episode:2};
  const e={STREAM_SOURCE_PROVIDER:'hybrid',STREMIO_ADDONS:'addon-a',AIOSTREAMS_USER_DATA:'profile-a'};
  const base=pinnedDiscoveryScope(p,e);assert.match(base,/^[a-f0-9]{64}$/);assert(!base.includes('private-key'));
  for(const patch of [{debridKey:'b'},{imdbId:'tt2'},{mediaType:'movie'},{season:2},{episode:3}])assert.notEqual(pinnedDiscoveryScope({...p,...patch},e),base);
  for(const patch of [{STREAM_SOURCE_PROVIDER:'other'},{STREMIO_ADDONS:'other'},{AIOSTREAMS_USER_DATA:'other'},{AIOSTREAMS_BASE_URL:'other'}])assert.notEqual(pinnedDiscoveryScope(p,{...e,...patch}),base);
  assert.equal(pinnedDiscoveryScope({...p,debridKey:''},e),null);
});

test('a listed pin bypasses discovery, clones metadata and retains the exact file', async () => {
  let calls=0;const resolve=createPinnedDiscoveryResolver(async()=>{calls++;return {candidates:[source(),source(1)],errors:[]};},{scopeOf,matches,identityOf});
  const initial=await resolve(context);initial.candidates[1].filename='mutated';
  const pin={...context,sourceToken:identityOf(source(1))};
  const first=await resolve(pin);assert.equal(calls,1);assert.equal(first.candidates.length,1);assert.equal(first.candidates[0].fileIdx,1);
  assert.equal(first.candidates[0].filename,'episode-1.mkv');first.candidates[0].filename='again';
  assert.equal((await resolve(pin)).candidates[0].filename,'episode-1.mkv');assert.equal(calls,1);
  await resolve(context);assert.equal(calls,2,'un-pinned list/Auto still obtains its complete inventory');
});
test('credentials, profile, title and episode cannot borrow another snapshot', async () => {
  let calls=0;const resolve=createPinnedDiscoveryResolver(async()=>{calls++;return {candidates:[source()],errors:[]};},{scopeOf,matches,identityOf});
  await resolve(context);
  for(const patch of [{credential:'other'},{profile:'other'},{movie:2},{episode:3}])await resolve({...context,...patch,sourceToken:identityOf(source())});
  assert.equal(calls,5);
});
test('missing/ambiguous pins fall through to real discovery; expired/bounded pools refetch', async () => {
  let clock=0,calls=0;const resolve=createPinnedDiscoveryResolver(async()=>{calls++;return {candidates:[source(),source(1)],errors:[]};},{scopeOf,matches,identityOf,now:()=>clock,ttlMs:10,maxEntries:1});
  await resolve(context);await resolve({...context,sourceToken:h});assert.equal(calls,2,'ambiguous raw hash does not guess a pack file');
  await resolve({...context,sourceToken:`${h}:index:999`});assert.equal(calls,3,'missing pin does not silently become a cached different file');
  clock=11;await resolve({...context,sourceToken:identityOf(source())});assert.equal(calls,4);
  await resolve({...context,movie:2});await resolve({...context,sourceToken:identityOf(source())});assert.equal(calls,6,'bounded eviction');
});
test('fresh discovery invalidates snapshots and an older in-flight result cannot repopulate them', async () => {
  let release,calls=0;const resolve=createPinnedDiscoveryResolver(async p=>{calls++;if(calls===1)return new Promise(r=>{release=r;});return {candidates:[],errors:['unavailable']};},{scopeOf,matches,identityOf});
  const pending=resolve(context);await Promise.resolve();
  await resolve({...context,requestDiscovery:true});release({candidates:[source()],errors:[]});await pending;
  await resolve({...context,sourceToken:identityOf(source())});assert.equal(calls,3);
});
test('an availability request for a pin includes only that candidate; Auto retains all', () => {
  const list=Array.from({length:60},(_,i)=>source(i));
  assert.equal(candidatesForPin(list,null,matches),list);
  assert.deepEqual(candidatesForPin(list,identityOf(source(35)),matches),[list[35]]);
  assert.deepEqual(candidatesForPin(list,'missing',matches),[]);
  assert.deepEqual(candidatesForPin(list,h,(candidate,token)=>candidate.infoHash===token),list,
    'a legacy bare hash retains matching pack files for ranking');
});
test('reuse binds the exact file, including safe legacy-name fallback', () => {
  const candidate=source(1), session={infoHash:h,fileId:7,sourceIdentity:identityOf(candidate),sourceFileName:candidate.filename};
  assert.equal(reusableSourceFile(session,candidate,identityOf),true);
  assert.equal(reusableSourceFile(session,source(),identityOf),false);
  assert.equal(reusableSourceFile({...session,infoHash:'b'.repeat(40)},candidate,identityOf),false);
  assert.equal(reusableSourceFile({...session,fileId:null},candidate,identityOf),false);
  const legacy={...session,sourceIdentity:undefined};assert.equal(reusableSourceFile(legacy,candidate,identityOf),true);
  assert.equal(reusableSourceFile(legacy,{...candidate,filename:'folder/'+candidate.filename},identityOf),false);
  assert.equal(reusableSourceFile({...legacy,sourceFileName:''},candidate,identityOf),false);
});
