/** @type {import('next').NextConfig} */

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development', // Disable PWA in development mode
  register: true,
  skipWaiting: true,
});

const nextConfig = {
  reactStrictMode: true, // Recommended for Next.js
  images: {
    // Avoid Vercel _next/image billing quota errors on Hobby/free usage.
    unoptimized: true,
    remotePatterns: [
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

module.exports = withPWA(nextConfig);
