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
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // Clickjacking: no page of the site may be shown inside another site's frame (the panel has one-click
        // actions: ban, delete, deploy). The badge stays embeddable: it is an <img>, which frames do not concern.
        { key: "X-Frame-Options", value: "DENY" },
        // No <base> hijack, no plugins, forms only towards the site itself. Scripts are not restricted here
        // (Next's inline scripts, Tebex.js): React's escaping is what stops XSS.
        { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; form-action 'self'" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=(), payment=(), browsing-topics=()" },
        // A page opened from another site gets no handle on our window (and the Tebex checkout popup keeps working).
        { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }
      ]
    }];
  }
};

export default nextConfig;
