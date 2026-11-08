import Link from "next/link";
import { getIdentity } from "@/lib/auth";
import { Wordmark } from "./brand";
import { CtaLink } from "./annuaire/track";
import "./annuaire/directory.css";
import "./growth.css";
import { LEGAL_LINKS } from "@/lib/legal";

/**
 * Header and footer of the public pages (directory, free scan, badge verification): the landing page's look, with
 * the call to server owners (acquisition).
 */
export default async function PublicFrame({ children }: { children: React.ReactNode }) {
  const identity = await getIdentity();
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap">
          <Link href="/" aria-label="Fiverax"><Wordmark size={30} /></Link>
          <nav>
            <Link href="/annuaire">Annuaire</Link>
            <Link href="/scan">Scan de sécurité gratuit</Link>
            <Link href="/annuaire?sort=players">Les plus joués</Link>
            <Link href="/annuaire?sort=votes">Top votes</Link>
            <Link href="/joueur">Espace joueur</Link>
          </nav>
          {identity ? <Link href="/servers" className="btn sm">Dashboard</Link> : <CtaLink href="/login" className="btn sm">Ajouter mon serveur</CtaLink>}
        </div>
      </header>
      <main className="lp-wrap">
        {children}
        <footer className="lp-foot">
          <Wordmark size={24} />
          <nav>
            <Link href="/annuaire">Annuaire des serveurs</Link>
            <Link href="/scan">Scan de sécurité gratuit</Link>
            <Link href="/joueur">Espace joueur</Link>
            <Link href="/">Fiverax</Link>
            <CtaLink href="/login">Référencer mon serveur</CtaLink>
            {LEGAL_LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
          </nav>
          <span>© {new Date().getFullYear()} Fiverax · Annuaire et sécurité des serveurs FiveM</span>
        </footer>
      </main>
    </div>
  );
}
