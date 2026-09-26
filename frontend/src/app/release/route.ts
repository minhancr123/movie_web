import { NextResponse } from 'next/server';

/**
 * Which build the frontend is actually running.
 *
 * A content-hashed chunk means the server can never hand out stale code, so the
 * only way a viewer is on old code is a tab that predates the deploy — which is
 * true and invisible from the page. Reading RELEASE_ID in a static page's meta
 * tag does not work: the page is prerendered at build time, where the variable
 * does not exist yet, so it renders "dev" forever. force-dynamic makes this
 * answer at request time from the running container.
 *
 * Served at /_release, not /api/release: Caddy routes every /api/* path to the
 * Node backend, so a Next.js route under /api is unreachable from the public
 * origin — it answered 404 before this moved.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    {
      release: process.env.RELEASE_ID || 'dev',
      build: process.env.NEXT_PUBLIC_BUILD_ID || null,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
