import Link from "next/link";
import { Star, Users } from "lucide-react";
import { tagLabel, type DirectoryCard, type LiveSummary } from "@/lib/directory-shared";
import { FRAMEWORKS } from "@/lib/studio-shared";

export const frameworkLabel = (key: string) => FRAMEWORKS.find((f) => f.key === key)?.label ?? key;

export function Stars({ value, size = 13 }: { value: number; size?: number }) {
  return (
    <span className="dir-stars" aria-label={`${value} sur 5`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={size} className={value >= i - 0.25 ? undefined : "off"} fill={value >= i - 0.25 ? "currentColor" : "none"} />)}
    </span>
  );
}

export function Logo({ url, name, className = "dir-logo" }: { url: string | null; name: string; className?: string }) {
  return (
    <span className={className}>
      {url ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function LiveLine({ live }: { live: LiveSummary | null }) {
  if (!live) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <i className={`dir-pulse ${live.online ? "" : "off"}`} />
      {live.online ? <><b>{live.players}</b>{live.maxClients ? ` / ${live.maxClients}` : ""} en ligne</> : "Hors ligne"}
    </span>
  );
}

export function ServerCard({ card }: { card: DirectoryCard }) {
  return (
    <Link href={`/annuaire/${card.slug}`} className="dir-card" data-featured={card.featured}>
      {card.featured && <span className="dir-badge">À la une</span>}
      <div className="dir-card-banner" style={card.bannerUrl ? { backgroundImage: `url("${card.bannerUrl.replace(/"/g, "")}")` } : undefined} />
      <div className="dir-card-body">
        <div className="dir-card-head">
          <Logo url={card.logoUrl} name={card.name} />
          <h3>{card.name}</h3>
        </div>
        {card.tagline && <p>{card.tagline}</p>}
        <div className="dir-meta">
          <LiveLine live={card.live} />
          {card.rating.count > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Stars value={card.rating.average ?? 0} size={12} /><b>{card.rating.average}</b> ({card.rating.count})</span>}
          {card.live && card.live.weekPlayers > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Users size={12} />{card.live.weekPlayers} cette semaine</span>}
        </div>
        <div className="dir-meta">
          {card.framework !== "standalone" && <span className="dir-tag">{frameworkLabel(card.framework)}</span>}
          {card.minAge > 0 && <span className="dir-tag">{card.minAge}+</span>}
          {card.tags.slice(0, 3).map((t) => <span key={t} className="dir-tag">{tagLabel(t)}</span>)}
        </div>
      </div>
    </Link>
  );
}
