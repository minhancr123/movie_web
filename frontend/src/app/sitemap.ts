import { MetadataRoute } from 'next';
import { getHome, catalogHref } from '@/lib/catalog';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://movieweb-ten.vercel.app';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date().toISOString();

  const staticRoutes = [
    '',
    '/kham-pha',
    '/kham-pha?type=tv',
    '/lich-chieu',
    '/cong-chieu',
    '/danh-sach-cua-toi',
  ].map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: now,
    changeFrequency: 'daily' as const,
    priority: route === '' ? 1 : 0.8,
  }));

  // Seed the sitemap from whatever the home rows currently surface. TMDB has
  // millions of titles, so enumerating everything is neither possible nor useful.
  let contentRoutes: MetadataRoute.Sitemap = [];
  try {
    const home = await getHome();
    const seen = new Set<string>();

    contentRoutes = [
      ...home.trending,
      ...home.popularMovies,
      ...home.popularTv,
      ...home.topRatedMovies,
    ]
      .filter((item) => {
        if (seen.has(item.contentRef)) return false;
        seen.add(item.contentRef);
        return true;
      })
      .map((item) => ({
        url: `${BASE_URL}${catalogHref(item)}`,
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      }));
  } catch (error) {
    console.error('Sitemap generation error:', error);
  }

  return [...staticRoutes, ...contentRoutes];
}
