import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import SubHarness from './harness';

/**
 * DEV-ONLY Playwright harness for subtitle/session-offset sync (paired with
 * e2e/media/server.mjs `/subs/vi.vtt` + e2e/subtitles.spec.ts). 404s in
 * production builds so it can never ship a test route to users.
 */
export default function SubTestPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Suspense>
      <SubHarness />
    </Suspense>
  );
}
