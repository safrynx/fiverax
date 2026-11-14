import type { Metadata } from "next";
import "./globals.css";
import "./marketing.css";
import { UIProvider } from "./ui";
import { OG_BASE, SITE_URL } from "@/lib/site";

// Fonts are loaded by the visitor's browser (not downloaded at build time by next/font/google, which breaks
// builds on hosts that cannot reach Google). globals.css falls back to these family names via var(--font-*).
const FONTS_URL = "https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700&family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Panel FiveM tout-en-un : direct, anticheat, staff et boutique Tebex · Fiverax", template: "%s · Fiverax" },
  description: "Le dashboard de ton serveur FiveM : joueurs en direct sur la carte, reports avec replay, console, anticheat et anti-raid, staff Discord, boutique Tebex et copilote IA.",
  openGraph: OG_BASE,
  twitter: { card: "summary_large_image" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS_URL} />
      </head>
      <body><UIProvider>{children}</UIProvider></body>
    </html>
  );
}
