import type { MetadataRoute } from 'next';

const BASE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.FRONTEND_URL ||
  'https://cinevn.me'
).replace(/\/+$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Trang xem, API, admin và trang cá nhân: login-walled / nội dung
        // mỏng, cho crawl chỉ tốn budget và gây trùng lặp với /phim/*.
        disallow: [
          '/api/',
          '/admin/',
          '/xem-phim/',
          '/profile',
          '/favorites',
          '/history',
          '/danh-sach-cua-toi/',
          '/tai-xuong/',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
