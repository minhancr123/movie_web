'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode, useEffect } from 'react';
import { initSentry } from '@/lib/sentry';

export default function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    initSentry();
  }, []);

  return <SessionProvider>{children}</SessionProvider>;
}
