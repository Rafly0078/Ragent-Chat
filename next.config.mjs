/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NOTE: no `images.remotePatterns` here on purpose. The app renders user/model
  // images with plain <img> (data: URLs and Supabase signed URLs), so nothing
  // uses next/image. A wildcard `hostname: '**'` would turn /_next/image into an
  // open image proxy anyone could point at any host, on the owner's bandwidth.
  experimental: {
    // `lucide-react` is already in Next's own default list, so it sits here as
    // documentation; `framer-motion` is not, and is the one doing work.
    optimizePackageImports: ['lucide-react', 'framer-motion'],
    // Tailwind output for this app is ~72 KB raw / 14 KB gzip — small enough
    // that inlining beats a render-blocking round trip. A <link> is discovered
    // only once the HTML has been parsed, so on a high-latency mobile
    // connection that request sat directly in front of first paint. The trade
    // is that returning visitors re-download the CSS with each document rather
    // than reading a cached stylesheet, which at this size is worth it.
    inlineCss: true,
  },
  // These packages do Node-specific things (native requires, internal
  // circular imports) that break when webpack tries to bundle them for
  // the Route Handler. Marking them external makes Next.js load them via
  // plain Node `require` at runtime instead, which avoids the
  // "Cannot access 'os' before initialization" TDZ error during build.
  // puppeteer-core resolves its browser at runtime and @sparticuz/chromium ships
  // a brotli-packed binary next to its own JS — bundling either rewrites those
  // paths and the launch fails with an unhelpful ENOENT deep inside the lambda.
  serverExternalPackages: [
    'exceljs',
    'pptxgenjs',
    'docx',
    'pdf-lib',
    'jszip',
    'puppeteer-core',
    '@sparticuz/chromium',
  ],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // SAMEORIGIN rather than DENY: the code sandbox embeds an iframe from
          // this origin, and DENY has broken same-origin embedding in the past.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // Never let a proxy or the browser cache an authenticated API response.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        // `/_next/static` gets `immutable` automatically because its filenames
        // are content-hashed; files in `public/` do not, so the icons were
        // revalidated on every cold load. Named explicitly rather than matched
        // by extension so `sw.js` is never caught by it — a long-cached service
        // worker is a service worker you cannot update.
        source: '/:file(icon.svg|apple-touch-icon.png|icon-192.png|icon-512.png|icon-192-maskable.png|icon-512-maskable.png)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
