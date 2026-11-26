import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page here is per-user and reads cookies or the database, so the app
  // uses plain dynamic rendering rather than Cache Components.
  serverExternalPackages: ["@electric-sql/pglite"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "image-cdn-ak.spotifycdn.com" },
      { protocol: "https", hostname: "image-cdn-fa.spotifycdn.com" },
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
