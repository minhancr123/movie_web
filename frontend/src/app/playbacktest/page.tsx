import { notFound } from 'next/navigation';
import PlaybackExtrasHarness from './harness';
export const dynamic = 'force-dynamic';
export default function PlaybackTestPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <PlaybackExtrasHarness />;
}
