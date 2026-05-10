/** @type {import('next').NextConfig} */
// Configured for STATIC EXPORT — `next build` produces fully-static HTML/CSS/JS
// in `out/`, which the root build pipeline copies into
// `server/public/portfolio/` so Express serves it on metflux.com.
//
// Static export implications:
//   - no `next start`, no API routes (those were removed)
//   - no Image optimizer (set unoptimized: true so <Image> still works)
//   - headers() / rewrites() / redirects() are inert (Express handles caching)
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  trailingSlash: false,
};

export default nextConfig;
