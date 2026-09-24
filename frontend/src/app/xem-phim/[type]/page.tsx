import { notFound, redirect } from 'next/navigation';
import {
  getCatalogDetail,
  watchHref,
  type MediaType,
} from '@/lib/catalog';

interface PageParams {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ tap?: string }>;
}

/**
 * Legacy single-segment watch URL (`/xem-phim/<slug>?tap=<ep>`) written by
 * Continue Watching / Downloads rows. The segment carries a contentRef
 * (`tmdb:movie:123`), resolved here to the canonical 3-segment watch URL.
 * Pre-TMDB-cutover phimapi slugs identify nothing — those 404 honestly.
 *
 * NOTE: this file must live in `[type]/page.tsx` (not `[slug]/page.tsx`):
 * Next.js forbids different dynamic param names at the same path level.
 */
export default async function LegacyWatchRedirect({ params, searchParams }: PageParams) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  // Next encodes ':' inside a dynamic path segment before exposing it through
  // `params` (for example `tmdb%3Amovie%3A496243`). Decode once so history
  // contentRefs are recognized instead of being mistaken for legacy slugs.
  let routeSegment = resolvedParams.type;
  try {
    routeSegment = decodeURIComponent(routeSegment);
  } catch {
    // A malformed percent escape is not a contentRef; handle it as legacy.
  }

  const match = /^tmdb:(movie|tv):(\d+)$/.exec(routeSegment);
  if (!match) {
    // Pre-cutover phimapi slug (e.g. `am-anh-2024`): carries no id, so turn
    // it back into a search query instead of serving a dead 404 — the user
    // picks the film and resumes from there.
    const guess = routeSegment.replace(/-/g, ' ').trim();
    redirect(`/search?keyword=${encodeURIComponent(guess)}`);
  }

  const type = match[1] as MediaType;
  const tmdbId = Number(match[2]);
  const detail = await getCatalogDetail(type, tmdbId);
  if (!detail) notFound();

  const tap = resolvedSearchParams.tap || '';
  const ep = /^s(\d+)e(\d+)$/.exec(tap);
  redirect(
    ep ? watchHref(detail, Number(ep[1]), Number(ep[2])) : watchHref(detail)
  );
}
