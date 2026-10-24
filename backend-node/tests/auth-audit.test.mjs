import test from 'node:test';
import assert from 'node:assert/strict';
import { authMetadata, describeUserAgent } from '../services/security/authAudit.js';
test('audit uses Express trusted request IP and ignores arbitrary forwarding headers',()=>{
  const result=authMetadata({ip:'198.51.100.8',headers:{'cf-connecting-ip':'1.2.3.4','x-real-ip':'1.2.3.5','user-agent':'Mozilla/5.0 (Linux; Android 10; K) Chrome/155.0.0.0 Mobile Safari/537.36'},body:{password:'secret'},user:{token:'secret'}});
  assert.equal(result.ip,'198.51.100.8');assert.equal(result.device.os,'Android');assert.equal(result.device.browser,'Chrome');
  assert.equal(result.password,undefined);assert.equal(result.token,undefined);
});
test('proxy loopback is unknown, never presented as the visitor address',()=>{
  for(const ip of ['127.0.0.1','::1','::ffff:127.0.0.1','bad-ip'])assert.equal(authMetadata({ip,headers:{}}).ip,null);
  assert.equal(authMetadata({ip:'2001:db8::8',headers:{}}).ip,'2001:db8::8');
});
test('user-agent values are bounded, control-free and treated as claims',()=>{
  const value=authMetadata({ip:'127.0.0.1',headers:{'user-agent':'A\r\nB'+'x'.repeat(2000)}});
  assert.equal(value.userAgent.length,1024);assert.doesNotMatch(value.userAgent,/[\r\n]/);
  assert.equal(describeUserAgent('Mozilla/5.0 Chrome/155 Safari/537.36 Edg/155').browser,'Edge');
  assert.equal(describeUserAgent('Mozilla/5.0 (iPhone) Version/18 Safari/605.1').os,'iOS / iPadOS');
  assert.equal(describeUserAgent('').type,'Không xác định');
});
