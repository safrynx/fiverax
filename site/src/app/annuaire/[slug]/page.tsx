import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Gamepad2, Globe, MessageCircle, ShoppingBag, Users } from "lucide-react";
import { can, getIdentity, getSessionUser } from "@/lib/auth";
import { getPublicListing, reviewEligibility } from "@/lib/directory";
import { discordUrl, joinUrl, LANGUAGES, tagLabel } from "@/lib/directory-shared";
import { frameworkLabel, LiveLine, Logo, Stars } from "../parts";
import { CtaLink, TrackLink, TrackView } from "../track";
import { voteState } from "@/lib/votes";
import Reviews from "./reviews";
import VoteBox from "./vote";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> };

/** Published listings for everyone; an unpublished one only for its staff (?preview=1). */
async function load({ params, searchParams }: Params) {
  const { slug } = await params;
  const identity = await getIdentity();
  const viewer = identity ? { discordId: identity.discordId, username: identity.username, avatarUrl: identity.avatarUrl ?? null } : null;
  const data = await getPublicListing(slug, { viewer, preview: true });
  if (!data) return null;
  if (!data.listing.published) {
    if ((await searchParams).preview !== "1") return null;
    const user = await getSessionUser(data.listing.serverId);
    if (!user || !can(user, "directory_edit")) return null;
  }
  return { data, viewer };
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const loaded = await load(props);
  if (!loaded) return { title: "Serveur introuvable" };
  const l = loaded.data.listing;
  const title = `${l.name} · Serveur FiveM`;
  const description = l.tagline || l.description.slice(0, 160);
  const image = l.bannerUrl || l.logoUrl || undefined;
  return {
    title: { absolute: `${title} · Fiverax` },
    description,
    alternates: { canonical: `/annuaire/${l.slug}` },
    robots: l.published ? undefined : { index: false, follow: false },
    openGraph: { title, description, type: "website", images: image ? [image] : undefined },
    twitter: { card: l.bannerUrl ? "summary_large_image" : "summary", title, description }
  };
}

export default async function ListingPage(props: Params) {
  const loaded = await load(props);
  if (!loaded) notFound();
  const { data, viewer } = loaded;
  const { listing: l, live, rating } = data;
  const join = l.connect ? joinUrl(l.connect) : null;
  const discord = l.discord ? discordUrl(l.discord) : null;
  const [eligibility, votes] = await Promise.all([
    reviewEligibility(l.serverId, viewer),
    voteState(l.serverId, viewer ? { discordId: viewer.discordId, username: viewer.username } : null, l.published)
  ]);
  const lang = LANGUAGES.find((x) => x.key === l.language)?.label ?? l.language;

  // Rich result for search engines (aggregate rating only when there are reviews).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: l.name,
    description: l.tagline || l.description.slice(0, 200),
    gamePlatform: "FiveM (GTA V)",
    image: l.bannerUrl || l.logoUrl || undefined,
    url: `${(process.env.APP_URL || "").replace(/\/$/, "")}/annuaire/${l.slug}`,
    ...(rating.count > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: rating.average, reviewCount: rating.count, bestRating: 5, worstRating: 1 } } : {})
  };

  return (
    <>
      {l.published && <TrackView slug={l.slug} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      {!l.published && <div className="banner" style={{ marginTop: 16 }}><b>Aperçu :</b> cette fiche n&apos;est pas encore publiée, seule ton équipe la voit.</div>}

      <div className="dir-show-banner" style={l.bannerUrl ? { backgroundImage: `url("${l.bannerUrl.replace(/"/g, "")}")` } : undefined} />
      <section className="dir-show-head">
        <Logo url={l.logoUrl || null} name={l.name} />
        <div style={{ flex: 1, minWidth: 240 }}>
          <Link href="/annuaire" className="linkish" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, marginBottom: 8 }}><ArrowLeft size={12} />Annuaire</Link>
          <h1>{l.name}</h1>
          {l.tagline && <p>{l.tagline}</p>}
          <div className="dir-meta" style={{ marginTop: 10 }}>
            {data.featured && <span className="dir-tag" data-on="true">À la une</span>}
            <LiveLine live={live} />
            {rating.count > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Stars value={rating.average ?? 0} /><b>{rating.average}</b> · {rating.count} avis</span>}
          </div>
        </div>
      </section>

      <div className="dir-actions">
        {join && <TrackLink slug={l.slug} kind="join" href={join} className="btn primary shine" external={join.startsWith("https://")}><Gamepad2 size={16} />Rejoindre le serveur</TrackLink>}
        {discord && <TrackLink slug={l.slug} kind="discord" href={discord} className="btn"><MessageCircle size={16} />Discord</TrackLink>}
        {data.storeSlug && <TrackLink slug={l.slug} kind="store" href={`/store/${data.storeSlug}`} className="btn" external={false}><ShoppingBag size={16} />Boutique</TrackLink>}
        {l.website && <TrackLink slug={l.slug} kind="website" href={l.website} className="btn"><Globe size={16} />Site</TrackLink>}
      </div>

      <div className="dir-layout">
        <div>
          {l.description ? <div className="dir-desc">{l.description}</div> : <p className="muted">Pas encore de présentation.</p>}
          {l.gallery.length > 0 && <div className="dir-gallery">{l.gallery.map((src) => <img key={src} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />)}</div>}
          <Reviews
            slug={l.slug}
            serverName={l.name}
            reviews={data.reviews}
            rating={rating}
            eligibility={eligibility}
            loggedIn={Boolean(viewer)}
            published={l.published}
          />
        </div>

        <aside>
          <VoteBox slug={l.slug} serverName={l.name} initial={votes} />
          {live && (
            <div className="dir-panel">
              <h2>En direct</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <i className={`dir-pulse ${live.online ? "" : "off"}`} />
                <span className="dir-live-num">{live.online ? live.players : "—"}</span>
                <span className="muted">{live.online ? `joueur${live.players > 1 ? "s" : ""} connecté${live.players > 1 ? "s" : ""}${live.maxClients ? ` sur ${live.maxClients}` : ""}` : "serveur hors ligne"}</span>
              </div>
              {live.weekPlayers > 0 && <p className="muted" style={{ margin: "12px 0 0", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}><Users size={13} />{live.weekPlayers} joueur{live.weekPlayers > 1 ? "s" : ""} différent{live.weekPlayers > 1 ? "s" : ""} ces 7 derniers jours</p>}
            </div>
          )}
          <div className="dir-panel">
            <h2>Infos</h2>
            <dl className="dir-info">
              <div><dt>Framework</dt><dd>{frameworkLabel(l.framework)}</dd></div>
              <div><dt>Langue</dt><dd>{lang}</dd></div>
              <div><dt>Âge minimum</dt><dd>{l.minAge ? `${l.minAge} ans` : "Aucun"}</dd></div>
              <div><dt>Accès</dt><dd>{l.tags.includes("whitelist") ? "Whitelist" : l.tags.includes("open") ? "Libre" : "Voir le Discord"}</dd></div>
              {l.connect && <div><dt>Adresse</dt><dd><code style={{ fontSize: 12 }}>{l.connect}</code></dd></div>}
            </dl>
            {l.tags.length > 0 && <div className="dir-tags">{l.tags.map((t) => <Link key={t} href={`/annuaire?tag=${t}`} className="dir-tag">{tagLabel(t)}</Link>)}</div>}
          </div>
          <div className="dir-panel" style={{ background: "radial-gradient(300px 160px at 100% 0%, rgba(var(--accent-rgb), 0.18), transparent 70%), var(--surface)" }}>
            <h2>Ton serveur ici ?</h2>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>{l.name} est géré avec Fiverax : staff, boutique, anticheat, assistant IA. Référence aussi le tien, c&apos;est gratuit.</p>
            <CtaLink href="/login" className="btn sm" >Découvrir Fiverax</CtaLink>
          </div>
        </aside>
      </div>
    </>
  );
}
