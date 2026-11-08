import Link from "next/link";
import { Mark } from "./brand";

export default function NotFound() {
  return (
    <main className="lost">
      <div>
        <Mark size={72} className="lost-mark" />
        <b className="gold">404</b>
        <p className="muted" style={{ margin: "8px 0 26px" }}>Cette page n&apos;existe pas, ou plus.</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/servers" className="btn primary">Mes serveurs</Link>
          <Link href="/" className="btn">Accueil</Link>
          <Link href="/annuaire" className="btn">Annuaire</Link>
          <Link href="/scan" className="btn">Scan gratuit</Link>
        </div>
      </div>
    </main>
  );
}
