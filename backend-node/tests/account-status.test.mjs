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
