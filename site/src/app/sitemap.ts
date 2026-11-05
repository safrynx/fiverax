import type { MetadataRoute } from "next";
import { sitemapListings } from "@/lib/directory";

export const dynamic = "force-dynamic";

/** Public pages for search engines: the landing page, the directory and every published listing. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  const listings = await sitemapListings().catch(() => []);
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/annuaire`, changeFrequency: "hourly", priority: 0.9 },
    ...listings.map((l) => ({ url: `${base}/annuaire/${l.slug}`, lastModified: new Date(l.updatedAt), changeFrequency: "daily" as const, priority: 0.7 }))
  ];
}
