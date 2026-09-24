import test from 'node:test';
import assert from 'node:assert/strict';
import {bootstrapAdmin} from '../services/adminBootstrap.js';

function fakeCollection(docs = []) {
  const history = [];
  return {
    findOne: async (q) => { history.push({op:'findOne',q}); return docs.find(d => d.email === q.email) || null; },
    updateOne: async (filter, update, opts) => {
      history.push({op:'updateOne',filter,update,opts});
      if (docs.find(d => d.email === filter.email)) return {upsertedCount:0};
      docs.push({...update.$setOnInsert});
      return {upsertedCount:1};
    },
    history
  };
}

test('creates admin on first run', async () => {
  const users = fakeCollection();
  const result = await bootstrapAdmin({users, email:'admin@test.com', password:'a'.repeat(16), hashPassword:async p=>'hashed:'+p, now:()=>new Date('2025-01-01')});
  assert.equal(result, 'created');
  assert.equal(users.history.filter(h=>h.op==='updateOne').length, 1);
});

test('second run returns exists', async () => {
  const users = fakeCollection([{email:'admin@test.com', role:'admin'}]);
  const result = await bootstrapAdmin({users, email:'admin@test.com', password:'b'.repeat(16), hashPassword:async p=>'hashed:'+p, now:()=>new Date()});
  assert.equal(result, 'exists');
});

test('rejects short password', async () => {
  const users = fakeCollection();
  await assert.rejects(() => bootstrapAdmin({users, email:'admin@test.com', password:'short', hashPassword:async p=>p, now:()=>new Date()}), /invalid bootstrap/);
});

test('rejects invalid email', async () => {
  const users = fakeCollection();
  await assert.rejects(() => bootstrapAdmin({users, email:'nope', password:'a'.repeat(16), hashPassword:async p=>p, now:()=>new Date()}), /invalid bootstrap/);
});

test('normalizes email', async () => {
  const users = fakeCollection();
  await bootstrapAdmin({users, email:' Admin@Test.COM ', password:'a'.repeat(16), hashPassword:async p=>'h:'+p, now:()=>new Date()});
  assert.equal(users.history[0].q.email, 'admin@test.com');
});

test('does not upgrade regular user to admin', async () => {
  const users = fakeCollection([{email:'user@test.com', role:'user'}]);
  const result = await bootstrapAdmin({users, email:'user@test.com', password:'b'.repeat(16), hashPassword:async p=>p, now:()=>new Date()});
  assert.equal(result, 'exists');
  // No updateOne should have been called to change role
  assert.equal(users.history.filter(h=>h.op==='updateOne').length, 0);
});
