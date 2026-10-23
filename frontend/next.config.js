/** @type {import('next').NextConfig} */

// next-pwa removed: the wrapper was disabled in every environment while the
// service worker itself is hand-written (public/sw.js) and registered by
// ServiceWorkerRegister — the wrapper only added build weight.
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true, // Recommended for Next.js
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
