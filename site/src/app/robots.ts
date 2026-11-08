import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Crawlers may read every public page; the panel, the API, the login and one-off pages (scan results, referral
 * redirects, badge images) stay out. "/scan/" with its slash blocks only the result pages, not the /scan tool itself.
 * /joueur is left open: the server portals live under /joueur/<slug>.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/s/", "/servers", "/login", "/scan/", "/r/", "/badge/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`
  };
}
