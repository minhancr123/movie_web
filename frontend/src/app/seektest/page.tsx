import { notFound } from 'next/navigation';
import SeekHarness from './harness';

/**
 * DEV-ONLY Playwright harness for far-seek behaviour (paired with
 * e2e/media/server.mjs + e2e/seek.spec.ts). 404s in production builds so it
 * can never ship a test route to users.
 */
export default function SeekTestPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <SeekHarness />;
}
