import test from 'node:test';import assert from 'node:assert/strict';
import { createAccountStatus, canModerateAccount } from '../services/security/accountStatus.js';
import { adminUserFilters } from '../services/admin/policy.js';
test('ban invalidates cached access and unlock restores it; deleted accounts cannot reuse JWT',async()=>{
 let time=1000,row={isBanned:false},reads=0;
 const status=createAccountStatus(async()=>{reads++;return row},()=>time);
 assert.equal(await status.blocked('u'),false);row={isBanned:true};assert.equal(await status.blocked('u'),false);
 status.invalidate('u');assert.equal(await status.blocked('u'),true);
 row={isBanned:false};time+=3001;assert.equal(await status.blocked('u'),false);
 row=null;status.invalidate('u');assert.equal(await status.blocked('u'),true);assert.equal(reads,4);
});
test('administrator/self protection and bounded creation filters',()=>{
 assert.equal(canModerateAccount('a',{_id:'a',role:'user'}),false);
 assert.equal(canModerateAccount('a',{_id:'b',role:'admin'}),false);
 assert.equal(canModerateAccount('a',{_id:'b',role:'user'}),true);
 assert.equal(adminUserFilters({createdWithin:'7',status:'banned'},7*86400000).createdAt.$gte.getTime(),0);
 assert.deepEqual(adminUserFilters({createdWithin:{$gt:0},status:{$ne:null}}),{});
});
test('an already-issued login token is rejected after ban, not just new sign-ins',async()=>{
 const {default:jwt}=await import('jsonwebtoken');
 const {accountStatus}=await import('../services/security/accountStatus.js');
 const {authMiddleware}=await import('../middleware/auth.js');
 const before=accountStatus.blocked;const previousSecret=process.env.JWT_SECRET;
 process.env.JWT_SECRET='account-moderation-fixture-secret';
 try {
  const token=jwt.sign({userId:'b'.repeat(24),role:'user'},process.env.JWT_SECRET);
  const res={code:200,status(n){this.code=n;return this},json(body){this.body=body;return this}};
  let called=false;
  accountStatus.blocked=async()=>true;
  await authMiddleware({headers:{authorization:`Bearer ${token}`}},res,()=>{called=true});
  assert.equal(called,false);assert.equal(res.code,403);assert.equal(res.body.code,'ACCOUNT_BANNED');
  accountStatus.blocked=async()=>false;
  await authMiddleware({headers:{authorization:`Bearer ${token}`}},res,()=>{called=true});
  assert.equal(called,true,'unlock permits the account again');
 }finally{accountStatus.blocked=before;if(previousSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previousSecret;}
});
