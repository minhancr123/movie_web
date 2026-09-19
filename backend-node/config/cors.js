/**
 * Browser origins the API answers.
 *
 * These used to be a literal array written during an earlier deployment, while
 * docker-compose.prod.yml passed CORS_ORIGIN and FRONTEND_URL that nothing
 * read. Moving to a new domain then failed every request with a CORS error
 * even though the compose file said the domain was configured — a deployment
 * fault that looks like an application fault.
 */

/** Local origins a developer always needs, without configuring anything. */
export const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
];

const normalize = (value) => {
  const raw = String(value ?? '').trim().replace(/\/+$/, '');
  if (!raw || raw === '*') return null;   // '*' with credentials is not a thing
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
};

/**
 * CORS_ORIGIN (comma separated) plus FRONTEND_URL, deduplicated.
 *
 * An unconfigured production deployment gets an EMPTY list rather than a
 * permissive one: refusing every browser is loud and immediately traceable to
 * the missing variable, while allowing every browser is silent and wrong.
 */
export const parseAllowedOrigins = (env = process.env) => {
  const configured = [
    ...String(env?.CORS_ORIGIN ?? '').split(','),
    env?.FRONTEND_URL ?? '',
  ]
    .map(normalize)
    .filter(Boolean);

  const isProduction = env?.NODE_ENV === 'production';
  const all = isProduction ? configured : [...DEV_ORIGINS, ...configured];
  return [...new Set(all)];
};
