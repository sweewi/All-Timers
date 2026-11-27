import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";
const IMG_HOSTS = [
  "https://i.scdn.co",
  "https://image-cdn-ak.spotifycdn.com",
  "https://image-cdn-fa.spotifycdn.com",
  "https://mosaic.scdn.co",
  "https://is1-ssl.mzstatic.com",
  "https://cdn.stats.fm",
];

/**
 * A static policy (no nonces) so pages stay cacheable: scripts only from this site,
 * images only from Spotify / stats.fm CDNs, the Spotify player as the one allowed
 * frame, and nobody may frame us.
 */
const CSP = [
  "default-src 'self'",
  // Vercel Speed Insights serves its script from this site in production, from Vercel's CDN in development
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval' https://va.vercel-scripts.com" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${IMG_HOSTS.join(" ")}`,
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "frame-src https://open.spotify.com",
  "media-src 'self' https://p.scdn.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  // Every page here is per-user and reads cookies or the database, so the app
  // uses plain dynamic rendering rather than Cache Components.
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/(.*)", headers: SECURITY_HEADERS },
      // personal data: never stored by shared caches
      { source: "/api/(.*)", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
  serverExternalPackages: ["@electric-sql/pglite"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "image-cdn-ak.spotifycdn.com" },
      { protocol: "https", hostname: "image-cdn-fa.spotifycdn.com" },
      { protocol: "https", hostname: "is1-ssl.mzstatic.com" },
      { protocol: "https", hostname: "cdn.stats.fm" },
      { protocol: "https", hostname: "mosaic.scdn.co" },
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
