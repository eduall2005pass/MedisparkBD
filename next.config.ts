import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  productionBrowserSourceMaps: false,
  images: {
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "app.medisparkbd.com" },
    ],
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 31536000,
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  experimental: {
    serverActions: { bodySizeLimit: "1000mb" },
    optimizePackageImports: [
      "firebase",
      "firebase-admin",
      "firebase/auth",
      "firebase/app",
      "firebase/messaging",
      "jspdf",
      "html2canvas",
    ],
    // Stale-while-revalidate for client router cache — avoids refetching on back/forward
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  // Public finance page: also served at the legacy /finance.php URL.
  rewrites: async () => [{ source: "/finance.php", destination: "/finance" }],
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-DNS-Prefetch-Control", value: "on" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    },
    // NOTE: no custom Cache-Control for /_next/static/* — Next.js already
    // serves those hashed assets as `public, max-age=31536000, immutable`
    // and warns if you try to override it.
    // Service worker + manifest must stay fresh (never immutable-cached).
    {
      source: "/sw.js",
      headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
    },
    {
      source: "/firebase-messaging-sw.js",
      headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
    },
    {
      source: "/manifest.webmanifest",
      headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
    },
    {
      source: "/:path*.(jpg|jpeg|png|webp|avif|svg|ico|woff|woff2)",
      headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ],
    },
  ],
};

export default nextConfig;