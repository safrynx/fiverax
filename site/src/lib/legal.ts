/**
 * Who publishes and hosts Fiverax, shown on the legal pages. Fiverax is published by a private individual
 * (non-professional), who may stay anonymous under LCEN art. 6-III-2 as long as the host has their identity; the
 * host's name, address and phone number must still be published. Fields set to null show "à compléter".
 */
export const LEGAL = {
  contactEmail: "ceo@fiverax.com",

  hostName: "Xevora",
  hostWebsite: "https://xevora.fr",
  hostAddress: null as string | null,
  hostPhone: null as string | null,

  /** Date shown as "dernière mise à jour" on the legal pages. */
  updatedAt: "8 novembre 2026"
};

export const LEGAL_LINKS = [
  { href: "/mentions-legales", label: "Mentions légales" },
  { href: "/confidentialite", label: "Confidentialité" },
  { href: "/cgu", label: "CGU" },
  { href: "/contact", label: "Contact" }
];
