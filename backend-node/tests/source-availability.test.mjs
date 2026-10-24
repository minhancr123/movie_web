import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceListingFailure, incompatibleSourcesFailure } from '../services/playback/sourceAvailability.js';
test('successful empty listing is unavailable content, not a transient provider outage', () => {
  assert.deepEqual(sourceListingFailure(), {status:404,code:'SOURCE_NOT_FOUND',retryable:false,
    message:'Phim này hiện chưa có nguồn phát trực tuyến hoặc chưa phát hành bản kỹ thuật số.'});
});
test('failed addon listing has an explicit transient code and never leaks upstream errors', () => {
  const result=sourceListingFailure(['upstream timeout https://example.invalid/?secret=private']);
  assert.equal(result.status,503); assert.equal(result.code,'SOURCE_LIST_UNAVAILABLE');
  assert.equal(result.retryable,true); assert.ok(!JSON.stringify(result).includes('private'));
});
test('all candidates rejected is permanent for this capability set', () => {
  assert.equal(incompatibleSourcesFailure.status,422);
  assert.equal(incompatibleSourcesFailure.code,'NO_COMPATIBLE_SOURCE');
  assert.equal(incompatibleSourcesFailure.retryable,false);
});
