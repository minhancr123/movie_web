export async function bootstrapAdmin({ users, email, password, hashPassword, now = () => new Date() }) {
  const normEmail = email.trim().toLowerCase();
  
  if (!normEmail.includes('@') || password.length < 16) {
    throw new Error('invalid bootstrap parameters');
  }

  const existing = await users.findOne({ email: normEmail });
  if (existing) {
    return 'exists';
  }

  const hashedPassword = await hashPassword(password);
  
  const result = await users.updateOne(
    { email: normEmail },
    {
      $setOnInsert: {
        email: normEmail,
        password: hashedPassword,
        role: 'admin',
        createdAt: now(),
        updatedAt: now()
      }
    },
    { upsert: true }
  );

  return result.upsertedCount > 0 ? 'created' : 'exists';
}
