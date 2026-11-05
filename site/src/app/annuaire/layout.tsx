import Link from "next/link";
import { getIdentity } from "@/lib/auth";
import { Wordmark } from "../brand";
import { CtaLink } from "./track";
import "./directory.css";

/** Public directory: same header and footer as the landing page, with the call to server owners (acquisition). */
export default async function DirectoryLayout({ children }: { children: React.ReactNode }) {
  const identity = await getIdentity();
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap">
          <Link href="/" aria-label="Fiverax"><Wordmark size={30} /></Link>
          <nav>
            <Link href="/annuaire">Annuaire</Link>
            <Link href="/annuaire?sort=players">Les plus joués</Link>
            <Link href="/annuaire?sort=rating">Les mieux notés</Link>
            <Link href="/">Fiverax pour ton serveur</Link>
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
            <Link href="/">Fiverax</Link>
            <CtaLink href="/login">Référencer mon serveur</CtaLink>
          </nav>
          <span>© {new Date().getFullYear()} Fiverax · Annuaire des serveurs FiveM qui utilisent Fiverax</span>
        </footer>
      </main>
    </div>
  );
}
