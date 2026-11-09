import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { OG_BASE } from "@/lib/site";
import { GUIDES } from "./content";

export const metadata: Metadata = {
  title: "Tutoriels",
  description: "Installer Fiverax pas à pas : ajouter ton serveur Discord, installer l'agent FiveM, régler l'anticheat et l'anti-raid, brancher ta boutique Tebex.",
  alternates: { canonical: "/guides" },
  openGraph: { ...OG_BASE, url: "/guides", title: "Tutoriels · Fiverax" }
};

/** Index of the tutorials, in the recommended order. */
export default function GuidesIndex() {
  return (
    <>
      <header className="guides-hero rise">
        <div className="eyebrow">Tutoriels</div>
        <h1>Tout installer, pas à pas.</h1>
        <p>Ton serveur Discord, l&apos;agent FiveM, l&apos;anticheat, l&apos;anti-raid et ta boutique Tebex : chaque guide tient en quelques minutes, avec les lignes exactes à copier.</p>
      </header>
      <nav className="guides-path" aria-label="Parcours conseillé">
        <span>Parcours conseillé :</span>
        {GUIDES.slice(0, 4).map((g, i) => (
          <span key={g.slug} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{i > 0 && <ArrowRight size={12} />}<Link href={`/guides/${g.slug}`}>{g.title}</Link></span>
        ))}
      </nav>
      <div className="guides-grid">
        {GUIDES.map((g, i) => (
          <Link key={g.slug} href={`/guides/${g.slug}`} className={`guide-card rise rise-${Math.min(i + 1, 4)}`} data-first={i === 0 || undefined}>
            <header><g.icon size={20} /><b>{g.title}</b></header>
            <p>{g.lead}</p>
            <small>{g.minutes} min</small>
          </Link>
        ))}
      </div>
    </>
  );
}
