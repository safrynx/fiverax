import type { Metadata } from "next";
import { DM_Sans, Unbounded } from "next/font/google";
import "./globals.css";
import "./marketing.css";
import { UIProvider } from "./ui";

const display = Unbounded({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-display-loaded", display: "swap" });
const body = DM_Sans({ subsets: ["latin"], variable: "--font-body-loaded", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: { default: "Fiverax · Dashboard FiveM", template: "%s · Fiverax" },
  description: "Fiverax : le dashboard de tes serveurs FiveM. Staff, boutique Tebex avec Store Creator IA, anticheat, activité vocale et en jeu, bilan IA hebdomadaire."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${display.variable} ${body.variable}`}>
      <body><UIProvider>{children}</UIProvider></body>
    </html>
  );
}
