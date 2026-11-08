/** Public address of the site, used for canonical URLs, the sitemap and structured data. */
export const SITE_URL = (process.env.APP_URL || "https://fiverax.com").replace(/\/+$/, "");

/** The one-line definition of Fiverax, repeated in metadata and structured data so search engines describe it the same way. */
export const SITE_DESCRIPTION =
  "Fiverax est le panel de gestion des serveurs FiveM : staff, boutique Tebex avec Store Creator IA, anticheat, scan de sécurité et activité vocale et en jeu, depuis Discord.";

/** Below this many published servers, the directory index stays out of search results (an empty list reads as a thin page). */
export const MIN_LISTINGS_TO_INDEX = 10;

/** Shared Open Graph fields: Next replaces a parent's openGraph object instead of merging it, so each page spreads these. */
export const OG_BASE = {
  siteName: "Fiverax",
  locale: "fr_FR",
  type: "website" as const,
  images: [{ url: "/opengraph-image.jpg", width: 1200, height: 630, alt: "Fiverax, le panel des serveurs FiveM" }]
};

/** Serialises JSON-LD for a <script> tag without letting "</script>" in user content close it. */
export function jsonLd(data: unknown): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, "\\u003c") };
}

export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
