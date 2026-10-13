import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// A Sentry public ingestion DSN is intended for browsers. Never return an
// API/auth token or any other server environment value here.
export function GET() {
  return NextResponse.json({
    dsn: process.env.SENTRY_FRONTEND_DSN || '',
    release: process.env.RELEASE_ID || '',
    environment: process.env.NODE_ENV || 'production',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
