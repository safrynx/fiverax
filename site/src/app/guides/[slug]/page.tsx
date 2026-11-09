import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OG_BASE, SITE_URL } from "@/lib/site";
import { GUIDES, guideBySlug } from "../content";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const guide = guideBySlug((await params).slug);
  if (!guide) return { title: "Tutoriel introuvable" };
  return {
    title: `${guide.title} · Tutoriel`,
    description: guide.lead,
    alternates: { canonical: `/guides/${guide.slug}` },
    openGraph: { ...OG_BASE, url: `/guides/${guide.slug}`, title: `${guide.title} · Fiverax` }
  };
}

/** One tutorial, with the list of all of them and the previous / next one. */
export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const guide = guideBySlug((await params).slug);
  if (!guide) notFound();
  const index = GUIDES.indexOf(guide);
  const prev = GUIDES[index - 1];
  const next = GUIDES[index + 1];
  const appUrl = SITE_URL;

  return (
    <div className="guide-layout">
      <nav className="guide-side" aria-label="Tutoriels">
        <small>Tutoriels</small>
        <Link href="/guides">Tous les tutoriels</Link>
        {GUIDES.map((g) => <Link key={g.slug} href={`/guides/${g.slug}`} data-on={g.slug === guide.slug}>{g.title}</Link>)}
      </nav>
      <article className="guide-article rise">
        <div className="eyebrow">Tutoriel · {guide.minutes} min</div>
        <h1>{guide.title}</h1>
        <p className="guide-lead">{guide.lead}</p>
        <div className="guide-body">{guide.body({ appUrl })}</div>
        <div className="guide-help">
          Une étape bloque ? Depuis le panel, clique <b>Signaler un bug</b> en bas du menu : ton message arrive directement à l&apos;équipe Fiverax. Sinon, la page <Link href="/contact">Contact</Link>.
        </div>
        <nav className="guide-nav" aria-label="Tutoriel précédent et suivant">
          {prev ? <Link href={`/guides/${prev.slug}`}><small>Précédent</small>{prev.title}</Link> : <span />}
          {next ? <Link href={`/guides/${next.slug}`} style={{ textAlign: "right" }}><small>Suivant</small>{next.title}</Link> : <span />}
        </nav>
      </article>
    </div>
  );
}
