import { MetadataRoute } from 'next';
import { getHome, catalogHref } from '@/lib/catalog';

export const revalidate = 1800;

const BASE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.FRONTEND_URL ||
  'https://cinevn.me'
).replace(/\/+$/, '');

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date().toISOString();

  // Chỉ route canonical tĩnh. Không đưa query (?type=tv), route login-walled
  // (/danh-sach-cua-toi) hay /xem-phim vào sitemap — Google phạt nội dung
  // mỏng/trùng lặp và phí crawl budget.
  const staticRoutes = ['', '/kham-pha', '/lich-chieu', '/cong-chieu'].map((route) => ({
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
