import jwt from 'jsonwebtoken';

// Registration, password login and Google login must use the same lifetime.
export const signAccountToken = (payload, env = process.env) => jwt.sign(
  payload,
  env.JWT_SECRET,
  { expiresIn: env.JWT_EXPIRE?.trim() || '30d' },
);
