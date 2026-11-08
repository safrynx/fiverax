import type { Metadata } from "next";
import "./globals.css";
import "./marketing.css";
import { UIProvider } from "./ui";

// Fonts are loaded by the visitor's browser (not downloaded at build time by next/font/google, which breaks
// builds on hosts that cannot reach Google). globals.css falls back to these family names via var(--font-*).
const FONTS_URL = "https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700&family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: { default: "Fiverax · Dashboard FiveM", template: "%s · Fiverax" },
  description: "Fiverax : le dashboard de tes serveurs FiveM. Staff, boutique Tebex avec Store Creator IA, anticheat, activité vocale et en jeu, bilan IA hebdomadaire."
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
