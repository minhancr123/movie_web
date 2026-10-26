/** @type {import('next').NextConfig} */

// next-pwa removed: the wrapper was disabled in every environment while the
// service worker itself is hand-written (public/sw.js) and registered by
// ServiceWorkerRegister — the wrapper only added build weight.
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true, // Recommended for Next.js
  async headers() {
    // These mutable entry points must not inherit a CDN's month-long JS cache.
    return ['/sw.js', '/offline.html'].map(source => ({ source, headers: [
      { key: 'Cache-Control', value: 'no-store, no-cache, max-age=0, must-revalidate' },
      { key: 'CDN-Cache-Control', value: 'no-store' },
      { key: 'Cloudflare-CDN-Cache-Control', value: 'no-store' },
    ] }));
  },
  images: {
    // Self-hosted standalone (no Vercel image quota): let Next optimize with
    // sharp — AVIF/WebP and right-sized hero backdrops instead of shipping
    // raw w500/w1280 TMDB JPEGs to phones.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
      },
      {
        protocol: 'https',
        hostname: 'phimimg.com',
      },
      {
        protocol: 'https',
        hostname: 'ui-avatars.com',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'img.phimapi.com', // Common alternate image source
      },
    ],
  },
};

module.exports = nextConfig;
