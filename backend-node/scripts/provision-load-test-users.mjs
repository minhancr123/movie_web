import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import { chmod, unlink, writeFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';

dotenv.config({ path: process.env.LOAD_TEST_ENV_FILE || '.env' });

const enabled = process.env.LOAD_TEST_PROVISION === 'yes';
const count = Number(process.env.LOAD_TEST_ACCOUNT_COUNT || 100);
const prefix = String(process.env.LOAD_TEST_ACCOUNT_PREFIX || 'k6test');
const output = process.env.LOAD_TEST_TOKENS_FILE || './load-test-tokens.txt';
const databaseName = process.env.MONGODB_DB_NAME || 'movieweb';
const cleanup = process.env.LOAD_TEST_CLEANUP === 'yes';

if (!enabled) throw new Error('Set LOAD_TEST_PROVISION=yes to run this script');
if (!Number.isInteger(count) || count < 1 || count > 1000) {
  throw new Error('LOAD_TEST_ACCOUNT_COUNT must be an integer from 1 to 1000');
}
if (!/^[a-z][a-z0-9-]{2,30}$/.test(prefix)) {
  throw new Error('LOAD_TEST_ACCOUNT_PREFIX must be a safe lowercase prefix');
}
if (!process.env.MONGODB_URI || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('MONGODB_URI and a JWT_SECRET of at least 32 characters are required');
}
if (databaseName === 'movieweb' && process.env.NODE_ENV !== 'production') {
  throw new Error('Set MONGODB_DB_NAME explicitly before provisioning accounts');
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
try {
  const users = client.db(databaseName).collection('users');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  if (cleanup) {
    const result = await users.deleteMany({
      isLoadTest: true,
      username: { $regex: `^${prefix}-[0-9]{3}$` },
    });
    await unlink(output).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    console.log(`Deleted ${result.deletedCount} load-test accounts from ${databaseName}`);
  } else {
    const password = randomBytes(24).toString('base64url');
    const passwordHash = await bcrypt.hash(password, 10);
    const documents = [];
    const tokens = [];

    for (let index = 1; index <= count; index += 1) {
      const suffix = String(index).padStart(3, '0');
      const username = `${prefix}-${suffix}`;
      const email = `${username}@load.invalid`;
      const userId = new ObjectId();
      documents.push({
        _id: userId,
        email,
        username,
        password: passwordHash,
        fullName: `Playback load test ${suffix}`,
        role: 'user',
        isLoadTest: true,
        loadTestExpiresAt: expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      tokens.push(jwt.sign(
        { userId, email, username, role: 'user' },
        process.env.JWT_SECRET,
        { expiresIn: '2h' },
      ));
    }

    await users.insertMany(documents, { ordered: true });
    await writeFile(output, `${tokens.join(',')}\n`, { mode: 0o600 });
    await chmod(output, 0o600);
    console.log(`Created ${count} load-test accounts in ${databaseName}`);
    console.log(`Token pool written to ${output}`);
    console.log(`Export with: export CINEVN_LOAD_TEST_TOKENS="$(cat ${output})"`);
    console.log(`Shared password (store temporarily, then discard): ${password}`);
  }
} finally {
  await client.close();
}
