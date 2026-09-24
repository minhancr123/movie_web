import test from 'node:test';
import assert from 'node:assert/strict';
import {readAppConfig} from '../config/runtime.js';

test('restore refuses production database', () => {
  assert.throws(() => readAppConfig({NODE_ENV:'test',RESTORE_DRILL:'true',MONGODB_DB_NAME:'movieweb'}), /restore target/);
});
test('database name is explicit and stable', () => {
  assert.equal(readAppConfig({NODE_ENV:'test'}).databaseName, 'movieweb');
});
test('missing required env in production fails with field name', () => {
  assert.throws(() => readAppConfig({NODE_ENV:'production'}), /JWT_SECRET/);
});
test('release ID must be 40 hex chars in production', () => {
  assert.throws(() => readAppConfig({NODE_ENV:'production',JWT_SECRET:'x'.repeat(40),NEXTAUTH_SECRET:'y'.repeat(40),MONGODB_URI:'mongodb://x/m',TOKEN_ENCRYPTION_KEYS:'1:'+Buffer.from('x'.repeat(32)).toString('base64'),RELEASE_ID:'short'}), /RELEASE_ID/);
});
test('media origin must be valid HTTPS without path', () => {
  assert.throws(() => readAppConfig({NODE_ENV:'test',PUBLIC_MEDIA_BASE_URL:'http://media.cineon.me'}), /HTTPS/);
  assert.throws(() => readAppConfig({NODE_ENV:'test',PUBLIC_MEDIA_BASE_URL:'https://media.cineon.me/path'}), /path/);
});
test('valid media origin is accepted', () => {
  const cfg = readAppConfig({NODE_ENV:'test',PUBLIC_MEDIA_BASE_URL:'https://media.cineon.me'});
  assert.equal(cfg.mediaOrigin, 'https://media.cineon.me');
});
test('drill accepts valid restore target', () => {
  const cfg = readAppConfig({NODE_ENV:'test',RESTORE_DRILL:'true',MONGODB_DB_NAME:'movieweb_restore_drill_1'});
  assert.equal(cfg.databaseName, 'movieweb_restore_drill_1');
});
