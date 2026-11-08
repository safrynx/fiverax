import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { sitemapListings } from "@/lib/directory";
import { LEGAL_LINKS } from "@/lib/legal";
import { MIN_LISTINGS_TO_INDEX, SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

const date = (s: string | null | undefined) => (s ? new Date(s) : undefined);

/**
 * Public pages for search engines: the landing page, the free scan, the directory (once it has enough servers),
 * every published listing, player portal and store. Badge pages are left out: they are reached from the badge itself.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [listings, portals, stores] = await Promise.all([
    sitemapListings().catch(() => []),
    db.all<{ slug: string; at: string | null }>("SELECT slug, COALESCE(published_at, updated_at) AS at FROM portal_sites WHERE published_json IS NOT NULL").catch(() => []),
    db.all<{ slug: string; at: string | null }>("SELECT slug, COALESCE(published_at, updated_at) AS at FROM store_sites WHERE published_json IS NOT NULL").catch(() => [])
  ]);
  return [
    { url: `${SITE_URL}/` },
    { url: `${SITE_URL}/scan` },
    ...LEGAL_LINKS.map((l) => ({ url: `${SITE_URL}${l.href}` })),
    ...(listings.length >= MIN_LISTINGS_TO_INDEX ? [{ url: `${SITE_URL}/annuaire` }] : []),
    ...listings.map((l) => ({ url: `${SITE_URL}/annuaire/${l.slug}`, lastModified: date(l.updatedAt) })),
    ...portals.map((p) => ({ url: `${SITE_URL}/joueur/${p.slug}`, lastModified: date(p.at) })),
    ...stores.map((s) => ({ url: `${SITE_URL}/store/${s.slug}`, lastModified: date(s.at) }))
  ];
}
