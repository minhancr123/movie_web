export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(
    { status: 'ready', release: process.env.RELEASE_ID ?? 'development' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
