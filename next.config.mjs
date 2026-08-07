/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NOTE: no `images.remotePatterns` here on purpose. The app renders user/model
  // images with plain <img> (data: URLs and Supabase signed URLs), so nothing
  // uses next/image. A wildcard `hostname: '**'` would turn /_next/image into an
  // open image proxy anyone could point at any host, on the owner's bandwidth.
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  // These packages do Node-specific things (native requires, internal
  // circular imports) that break when webpack tries to bundle them for
  // the Route Handler. Marking them external makes Next.js load them via
  // plain Node `require` at runtime instead, which avoids the
  // "Cannot access 'os' before initialization" TDZ error during build.
  serverExternalPackages: ['exceljs', 'pptxgenjs', 'docx', 'pdf-lib', 'jszip'],

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
    ];
  },
};

export default nextConfig;
