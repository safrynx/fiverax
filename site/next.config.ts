import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets a build run next to a live `next dev` without fighting over .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@libsql/client", "libsql"],
  poweredByHeader: false,
  async redirects() {
    // One host for search engines: www.fiverax.com served a full copy of the site.
    return [{ source: "/:path*", has: [{ type: "host", value: "www.fiverax.com" }], destination: "https://fiverax.com/:path*", permanent: true }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }
      ]
    }];
  }
};

export default nextConfig;
