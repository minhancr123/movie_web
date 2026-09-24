import test from 'node:test';
import assert from 'node:assert';
import { verifyProject } from '../verify-project.mjs';

test('verifyProject should be a function', () => {
    assert.strictEqual(typeof verifyProject, 'function');
});
