import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrafficWindow } from '../services/admin/traffic.js';
import { validCatalogLimit, parseAdminList, literalSearch, USER_FIELDS, SESSION_FIELDS } from '../services/admin/policy.js';

test('traffic counts only the last 60 seconds and resets with a new process window', () => {
  const traffic = createTrafficWindow();
  traffic.record(200, 100000); traffic.record(503, 101000); traffic.record(404, 102000);
  assert.deepEqual(traffic.read(102000), { requests: 3, errors: 1, windowSeconds: 60 });
  assert.deepEqual(traffic.read(161000), { requests: 1, errors: 0, windowSeconds: 60 });
  assert.equal(traffic.read(162000).requests, 0);
  assert.equal(createTrafficWindow().read(102000).requests, 0);
});
test('catalog protection cannot be disabled with malformed or unbounded values', () => {
  for (const value of [0, -1, 29, 3001, 120.5, '120', null, NaN, Infinity, {}, []]) assert.equal(validCatalogLimit(value), false);
  for (const value of [30, 120, 3000]) assert.equal(validCatalogLimit(value), true);
});
test('admin lists bound pagination and refuse operator-shaped search/role values', () => {
  assert.deepEqual(parseAdminList({page:'-8',limit:'-20',search:{$ne:null},role:{$ne:null}}), {page:1,limit:1,search:'',role:undefined});
  assert.deepEqual(parseAdminList({page:'999999',limit:'9999',role:'admin',search:'  Alice  '}), {page:10000,limit:100,role:'admin',search:'Alice'});
  assert.equal(parseAdminList({search:'x'.repeat(1000)}).search.length, 100);
});
test('search treats regex metacharacters as text', () => {
  const input = 'alice+test@example.com (admin) [1] .*';
  const pattern = new RegExp(literalSearch(input), 'i');
  assert.equal(pattern.test(input), true);
  assert.equal(pattern.test('aliceeeeeetest@exampleXcom admin 1 anything'), false);
});
test('admin list projections never expose account secrets or playback capabilities', () => {
  assert.deepEqual(Object.keys(USER_FIELDS).sort(), ['authProvider','createdAt','email','lastLogin','registration','role','updatedAt','username']);
  for (const key of ['password','passwordHash','apiKey','connections','sourceToken','directUrl','infoHash','mediaGrant','videoHash','sourceFileName']) {
    assert.equal(USER_FIELDS[key], undefined); assert.equal(SESSION_FIELDS[key], undefined);
  }
  assert.equal(SESSION_FIELDS.tmdbId, 1);
});
