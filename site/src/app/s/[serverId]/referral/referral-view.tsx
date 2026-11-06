"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Award, Check, Circle, Gift, Link2, MousePointerClick, Sparkles, Users } from "lucide-react";
import { REFERRAL_STATUS_LABEL } from "@/lib/referrals-shared";
import type { ReferralOverview } from "@/lib/referrals";
import { formatDateTime } from "@/lib/format";
import CopyText from "@/app/copy-text";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

type Props = {
  overview: ReferralOverview;
  share: string;
  listingPublished: boolean;
  featuredUntil: string | null;
  milestones: { at: number; days: number; label: string }[];
};

const TONE = { pending: "warn", qualified: "up", rejected: "danger", expired: undefined } as const;
const KIND: Record<string, string> = { referral: "Parrainage", welcome: "Bienvenue", milestone: "Palier", redeem: "Utilisé", refund: "Remboursé" };

export default function ReferralView({ overview: o, share, listingPublished, featuredUntil, milestones }: Props) {
  const paths = useServerPaths();
  const router = useRouter();
  const { toast } = useUI();
  const [days, setDays] = useState(Math.min(7, Math.max(1, o.balance)));
  const [busy, setBusy] = useState(false);
  const nextMilestone = milestones.find((m) => m.at > o.qualified);

  async function redeem() {
    setBusy(true);
    try {
      const res = await fetch(paths.api("referral?action=redeem"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast(describeApiError(data, res.status), "error");
      toast(`${days} jour${days > 1 ? "s" : ""} à la une ajouté${days > 1 ? "s" : ""}.`, "ok");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="strip rise rise-1">
        <div><div className="eyebrow">Jours à la une</div><div className="num">{o.balance}</div><small>à utiliser</small></div>
        <div><div className="eyebrow">Parrainages validés</div><div className="num">{o.qualified}</div><small>{o.tier ? o.tier.label : nextMilestone ? `${nextMilestone.at - o.qualified} avant « ${nextMilestone.label} »` : ""}</small></div>
        <div><div className="eyebrow">En attente</div><div className="num">{o.referrals.filter((r) => r.status === "pending").length}</div><small>serveurs inscrits</small></div>
        <div><div className="eyebrow">Clics sur ton lien</div><div className="num">{o.clicks}</div><small>depuis le début</small></div>
      </div>

      <div className="cols" style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))" }}>
        <section className="panel rise rise-2">
          <header className="panel-head"><h2 className="h2"><Link2 size={17} style={{ verticalAlign: -3, marginRight: 6 }} />Ton lien</h2></header>
          <div className="gx-embed-head" style={{ marginTop: 14 }}><code className="gx-link">{o.link}</code><CopyText text={o.link} /></div>
          <p className="muted" style={{ fontSize: 13 }}>
            Il mène à l&apos;accueil de Fiverax. Ton badge « Protégé par Fiverax » et ta fiche annuaire portent déjà ce lien : chaque propriétaire qui clique dessus puis ajoute son serveur devient ton filleul.
          </p>
          <div className="gx-embed-head" style={{ marginTop: 16 }}><b>Message à partager sur Discord</b><CopyText text={share} /></div>
          <pre className="gx-code small">{share}</pre>
          <div className="gx-embed-head" style={{ marginTop: 12 }}><b>Lien direct vers le scan gratuit</b><CopyText text={`${o.link}?to=scan`} /></div>
        </section>

        <section className="panel rise rise-2">
          <header className="panel-head"><h2 className="h2"><Gift size={17} style={{ verticalAlign: -3, marginRight: 6 }} />Utiliser mes jours</h2></header>
          {!listingPublished ? (
            <p className="muted" style={{ marginTop: 14 }}>Publie d&apos;abord ta <Link href={paths.page("/directory")} className="linkish">fiche annuaire</Link> : les jours gagnés la mettent « À la une ».</p>
          ) : o.balance < 1 ? (
            <p className="muted" style={{ marginTop: 14 }}>Pas encore de jours gagnés. Partage ton lien : le premier serveur validé t&apos;en rapporte 7.</p>
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
              <input className="field" type="number" min={1} max={Math.min(90, o.balance)} value={days} onChange={(e) => setDays(Math.max(1, Math.min(o.balance, Math.floor(Number(e.target.value) || 1))))} style={{ width: 90 }} />
              <span className="muted">jour{days > 1 ? "s" : ""}</span>
              <button className="btn primary" disabled={busy} onClick={redeem}><Sparkles size={14} />Mettre ma fiche à la une</button>
            </div>
          )}
          {featuredUntil && <p className="muted" style={{ fontSize: 13 }}>À la une jusqu&apos;au {formatDateTime(featuredUntil)} (les nouveaux jours s&apos;ajoutent après).</p>}
          <div className="gx-milestones">
            {milestones.map((m) => (
              <div key={m.at} data-on={o.qualified >= m.at}><Award size={16} /><b>{m.label}</b><small>{m.at} parrainages · +{m.days} jours bonus{m.at === 3 ? " et le titre sur ta fiche" : ""}</small></div>
            ))}
          </div>
          {o.referredBy && <p className="muted" style={{ fontSize: 13 }}>Ton serveur a été parrainé par <b>{o.referredBy.name}</b> ({REFERRAL_STATUS_LABEL[o.referredBy.status].toLowerCase()}).</p>}
        </section>
      </div>

      <section className="sect">
        <header><h2 className="h2"><Users size={17} style={{ verticalAlign: -3, marginRight: 6 }} />Serveurs parrainés</h2></header>
        {o.referrals.length === 0 ? (
          <p className="muted"><MousePointerClick size={14} style={{ verticalAlign: -2 }} /> Personne pour l&apos;instant.</p>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Serveur</th><th>Inscrit le</th><th>État</th><th>Progression</th></tr></thead>
              <tbody>
                {o.referrals.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.name}</b></td>
                    <td>{formatDateTime(r.createdAt)}</td>
                    <td><span className="tag" data-tone={TONE[r.status]}>{REFERRAL_STATUS_LABEL[r.status]}</span></td>
                    <td>
                      {r.progress ? (
                        <span className="gx-progress">{r.progress.steps.map((s) => <span key={s.label} data-done={s.done}>{s.done ? <Check size={12} /> : <Circle size={12} />}{s.label}</span>)}</span>
                      ) : r.qualifiedAt ? `Validé le ${formatDateTime(r.qualifiedAt)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {o.ledger.length > 0 && (
        <section className="sect">
          <header><h2 className="h2">Historique des jours</h2></header>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Type</th><th>Détail</th><th style={{ textAlign: "right" }}>Jours</th></tr></thead>
              <tbody>
                {o.ledger.map((l) => (
                  <tr key={l.id}>
                    <td>{formatDateTime(l.createdAt)}</td>
                    <td>{KIND[l.kind] ?? l.kind}</td>
                    <td className="muted">{l.note}</td>
                    <td style={{ textAlign: "right", color: l.days > 0 ? "var(--ok)" : "var(--muted)" }}><b>{l.days > 0 ? `+${l.days}` : l.days}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
