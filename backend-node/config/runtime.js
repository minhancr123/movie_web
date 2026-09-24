export function readAppConfig(env) {
  const isProd = env.NODE_ENV === 'production';
  const isDrill = env.RESTORE_DRILL === 'true';

  let databaseName = env.MONGODB_DB_NAME || 'movieweb';

  if (isDrill) {
    if (databaseName === 'movieweb') {
      throw new Error('Invalid restore target: cannot use movieweb in drill mode');
    }
    if (!/^movieweb_restore_[a-z0-9_-]+$/.test(databaseName)) {
      throw new Error('Invalid restore target name');
    }
  }

  if (isProd) {
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET is missing or too short');
    if (!env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET.length < 32) throw new Error('NEXTAUTH_SECRET is missing or too short');
    if (!env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    if (!env.TOKEN_ENCRYPTION_KEYS || !/^\d+:[A-Za-z0-9+/=]+$/.test(env.TOKEN_ENCRYPTION_KEYS)) {
      throw new Error('TOKEN_ENCRYPTION_KEYS is missing or invalid format');
    }
    if (!env.RELEASE_ID || !/^[0-9a-fA-F]{40}$/.test(env.RELEASE_ID)) {
      throw new Error('RELEASE_ID is missing or invalid format');
    }
  }

  let mediaOrigin = env.PUBLIC_MEDIA_BASE_URL || '';
  if (mediaOrigin) {
    try {
      const url = new URL(mediaOrigin);
      if (url.protocol !== 'https:') throw new Error();
      if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
        throw new Error();
      }
      mediaOrigin = url.origin;
    } catch {
      throw new Error('PUBLIC_MEDIA_BASE_URL must be a valid HTTPS URL without path or query');
    }
  }

  return {
    databaseName,
    releaseId: env.RELEASE_ID,
    mediaOrigin
  };
}
