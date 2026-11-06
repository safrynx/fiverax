import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { listDirectory } from "@/lib/directory";
import { DIRECTORY_SORTS, DIRECTORY_TAGS, LANGUAGES, type DirectorySort } from "@/lib/directory-shared";
import { FRAMEWORKS } from "@/lib/studio-shared";
import { ServerCard } from "./parts";
import { CtaLink } from "./track";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Annuaire des serveurs FiveM RP · Fiverax" },
  description: "Trouve ton prochain serveur FiveM : joueurs en direct, avis de vrais joueurs, whitelist ou accès libre, ESX, QBCore, Qbox. Tous les serveurs gérés avec Fiverax.",
  alternates: { canonical: "/annuaire" },
  openGraph: { title: "Annuaire des serveurs FiveM · Fiverax", description: "Joueurs en direct et avis vérifiés des serveurs FiveM RP.", type: "website" }
};

type Search = { q?: string; tag?: string; fw?: string; lang?: string; online?: string; safe?: string; sort?: string };
const SORT_LABEL: Record<DirectorySort, string> = { relevance: "Pertinence", players: "Joueurs en ligne", votes: "Plus votés ce mois", rating: "Mieux notés", recent: "Nouveaux" };

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const sort: DirectorySort = (DIRECTORY_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as DirectorySort) : "relevance";
  const tag = DIRECTORY_TAGS.some((t) => t.key === sp.tag) ? sp.tag : undefined;
  const fw = FRAMEWORKS.some((f) => f.key === sp.fw) ? sp.fw : undefined;
  const lang = LANGUAGES.some((l) => l.key === sp.lang) ? sp.lang : undefined;
  const online = sp.online === "1";
  const safe = sp.safe === "1";
  const q = sp.q?.trim().slice(0, 80) ?? "";
  const { cards, featured, total } = await listDirectory({ q, tag, framework: fw, language: lang, online, protectedOnly: safe, sort });
  const filtered = Boolean(q || tag || fw || lang || online || safe);
  const playing = cards.reduce((n, c) => n + (c.live?.online ? c.live.players : 0), 0);
  const href = (change: Partial<Search>) => {
    const next = { q: q || undefined, tag, fw, lang, online: online ? "1" : undefined, safe: safe ? "1" : undefined, sort: sort === "relevance" ? undefined : sort, ...change };
    const qs = new URLSearchParams(Object.entries(next).filter((e): e is [string, string] => Boolean(e[1]))).toString();
    return qs ? `/annuaire?${qs}` : "/annuaire";
  };

  return (
    <>
      <section className="dir-hero">
        <span className="lp-chip rise"><b>Annuaire</b>Les serveurs FiveM qui tournent avec Fiverax</span>
        <h1 className="rise rise-1">Trouve ton prochain <span className="gold">serveur RP</span>.</h1>
        <p className="rise rise-2">Les joueurs connectés en direct, les avis de joueurs qui y ont vraiment joué, et tout ce qu&apos;il faut savoir avant de te lancer : whitelist, âge, framework, Discord.</p>
        <div className="dir-facts rise rise-3">
          <span><b>{total}</b>serveur{total > 1 ? "s" : ""}</span>
          <span><b>{playing}</b>joueur{playing > 1 ? "s" : ""} en ligne{filtered ? " (filtre)" : ""}</span>
        </div>
      </section>

      {!filtered && featured.length > 0 && (
        <section className="dir-section">
          <header><h2>À la une</h2></header>
          <div className="dir-grid">{featured.map((c) => <ServerCard key={c.serverId} card={c} />)}</div>
        </section>
      )}

      <section className="dir-section">
        <form className="dir-filters" action="/annuaire">
          <Search size={16} style={{ color: "var(--muted)" }} />
          <input type="search" name="q" defaultValue={q} placeholder="Nom du serveur, ambiance…" className="field" />
          <select name="fw" defaultValue={fw ?? ""} className="field">
            <option value="">Tous les frameworks</option>
            {FRAMEWORKS.filter((f) => f.key !== "standalone").map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <select name="lang" defaultValue={lang ?? ""} className="field">
            <option value="">Toutes les langues</option>
            {LANGUAGES.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
          <select name="sort" defaultValue={sort} className="field">
            {DIRECTORY_SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>
            <input type="checkbox" name="online" value="1" defaultChecked={online} /> En ligne
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }} title="Serveurs dont la sécurité est vérifiée par Fiverax">
            <input type="checkbox" name="safe" value="1" defaultChecked={safe} /> Protégés
          </label>
          {tag && <input type="hidden" name="tag" value={tag} />}
          <button className="btn primary">Filtrer</button>
        </form>
        <div className="dir-tags">
          {DIRECTORY_TAGS.map((t) => <Link key={t.key} href={href({ tag: tag === t.key ? undefined : t.key })} className="dir-tag" data-on={tag === t.key}>{t.label}</Link>)}
          {filtered && <Link href="/annuaire" className="dir-tag">Tout effacer</Link>}
        </div>
      </section>

      <section className="dir-section">
        <header>
          <h2>{filtered ? `${cards.length} résultat${cards.length > 1 ? "s" : ""}` : sort === "votes" ? "Classement des votes du mois" : "Tous les serveurs"}</h2>
          {!filtered && <Link href="/joueur" className="linkish" style={{ fontSize: 13 }}>Ton espace joueur : temps de jeu, votes, sanctions</Link>}
        </header>
        {cards.length === 0
          ? <p className="dir-empty">{total === 0 ? "L'annuaire ouvre : les premiers serveurs arrivent." : "Aucun serveur ne correspond. Essaie d'enlever un filtre."}</p>
          : <div className="dir-grid">{cards.map((c, i) => <ServerCard key={c.serverId} card={c} rank={sort === "votes" && c.votes > 0 ? i + 1 : undefined} />)}</div>}
      </section>

      <section className="dir-cta">
        <div>
          <h2>Tu gères un serveur FiveM ?</h2>
          <p>Fiverax gère ton staff, ta boutique Tebex, ton anticheat et ton serveur en jeu, et t&apos;ajoute à cet annuaire. Les joueurs te trouvent, voient qui est connecté et lisent les avis de tes joueurs. Les serveurs « Protégés par Fiverax » remontent dans le classement.</p>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <CtaLink href="/login" className="btn primary shine">Référencer mon serveur<ArrowRight size={16} /></CtaLink>
          <Link href="/scan" className="btn">Scan de sécurité gratuit</Link>
        </div>
      </section>
    </>
  );
}
