import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BadgeCheck, CalendarCheck, Info, ScanSearch, ShieldCheck } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { publicProtection } from "@/lib/protection";
import { levelOf, LEVELS, levelRank } from "@/lib/protection-shared";
import { ensureCode } from "@/lib/referrals";
import { Logo } from "../../annuaire/parts";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await publicProtection((await params).id);
  if (!data) return { title: "Badge introuvable", robots: { index: false } };
  const level = levelOf(data.level);
  const title = data.level === "none" ? `${data.name} · vérification Fiverax` : `${data.name} est ${level.label.toLowerCase()} par Fiverax`;
  const description = data.level === "none"
    ? "Ce serveur FiveM est en cours de vérification par Fiverax."
    : `Niveau ${level.label}${data.score !== null ? `, score de sécurité ${data.score}/100` : ""} : ${data.protections.slice(0, 3).join(", ").toLowerCase()}.`;
  return {
    title: { absolute: `${title} · Fiverax` },
    description,
    alternates: { canonical: `/protection/${data.publicId}` },
    // A server still being checked has nothing to show yet: keep that page out of search results.
    robots: data.level === "none" ? { index: false, follow: true } : undefined,
    openGraph: { title, description, type: "website", images: [`/badge/${data.publicId}.svg`] }
  };
}

/** What a visitor who clicked the badge sees: what Fiverax verified, never the problems. */
export default async function ProtectionPage({ params }: Props) {
  const data = await publicProtection((await params).id, { countView: true });
  if (!data) notFound();
  const level = levelOf(data.level);
  const code = await ensureCode(data.serverId).catch(() => null);
  const join = code ? `/r/${code}?to=scan` : "/scan";
  const active = data.level !== "none";

  return (
    <>
      <section className="gx-verify">
        <div className="gx-shield" data-level={data.level} style={{ "--lvl": level.color } as React.CSSProperties}>
          <svg viewBox="0 0 24 24" width={120} height={120} aria-hidden="true">
            <path d="M12 2 4 5v6c0 5 3.4 9.6 8 11 4.6-1.4 8-6 8-11V5l-8-3z" fill="currentColor" fillOpacity={0.14} stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
            {active && <path d="m8.4 12.2 2.5 2.5 4.9-5.2" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
        </div>
        <div>
          <div className="eyebrow">Vérification Fiverax</div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <Logo url={data.iconUrl} name={data.name} />
            {data.name}
          </h1>
          {active ? (
            <p className="gx-verdict">Niveau <b style={{ color: level.color }}>{level.label}</b>{data.score !== null && <> · score de sécurité <b>{data.score}/100</b></>}</p>
          ) : (
            <p className="gx-verdict">Vérification en cours : ce serveur n&apos;a pas encore atteint le premier niveau.</p>
          )}
          {data.lastScanAt && <p className="muted" style={{ display: "flex", alignItems: "center", gap: 6, margin: "8px 0 0" }}><CalendarCheck size={14} />Dernière analyse du code : {formatDateTime(data.lastScanAt)}</p>}
          <div className="dir-actions">
            {data.listingSlug && <Link href={`/annuaire/${data.listingSlug}`} className="btn primary">Voir la fiche du serveur<ArrowRight size={15} /></Link>}
          </div>
        </div>
      </section>

      <div className="dir-layout">
        <div>
          {data.protections.length > 0 && (
            <section className="dir-section" style={{ marginTop: 10 }}>
              <header><h2>Ce que Fiverax a vérifié</h2></header>
              <ul className="gx-proofs">
                {data.protections.map((p) => <li key={p}><BadgeCheck size={16} />{p}</li>)}
              </ul>
            </section>
          )}
          <section className="dir-section">
            <header><h2>Les niveaux</h2></header>
            <div className="gx-levels">
              {LEVELS.slice(1).map((l) => (
                <div key={l.key} data-on={levelRank(data.level) >= levelRank(l.key)} style={{ "--lvl": l.color } as React.CSSProperties}>
                  <ShieldCheck size={18} />
                  <b>{l.label}</b>
                  <small>
                    {l.key === "protected" && "Agent relié, code analysé ce mois-ci sans faille critique, anticheat actif."}
                    {l.key === "reinforced" && "Score ≥ 80, aucun événement exploitable, anti-raid Discord et alertes du staff."}
                    {l.key === "fortress" && "Score ≥ 92, scan continu, vérifié cette semaine, bans partagés du réseau."}
                  </small>
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 13, display: "flex", gap: 8 }}>
              <Info size={14} style={{ flex: "none", marginTop: 2 }} />
              Rien n&apos;est déclaratif : chaque point est vérifié par Fiverax à partir du serveur lui-même (agent FiveM, analyse du code, réglages actifs), et le niveau se recalcule en permanence.
              Le détail des analyses reste privé, réservé à l&apos;équipe du serveur.
            </p>
          </section>
        </div>

        <aside>
          <div className="dir-panel" style={{ background: "radial-gradient(300px 160px at 100% 0%, rgba(var(--accent-rgb), 0.2), transparent 70%), var(--surface)" }}>
            <h2>Tu as un serveur FiveM ?</h2>
            <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>Découvre son score de sécurité en 10 secondes, gratuitement, puis obtiens le même badge.</p>
            <a href={join} className="btn primary"><ScanSearch size={15} />Scanner mon serveur</a>
          </div>
        </aside>
      </div>
    </>
  );
}
