"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Check, Circle, Download, ExternalLink, Package, Rocket, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import {
  KIT, levelOf, LEVELS, levelRank,
  type FixPage, type KitKey, type LevelKey, type ProtectionCheck, type ProtectionPlan
} from "@/lib/protection-shared";
import { formatDateTime } from "@/lib/format";
import CopyText from "@/app/copy-text";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

type Props = {
  status: { level: LevelKey; checks: ProtectionCheck[]; next: { level: LevelKey; missing: ProtectionCheck[] } | null; score: number | null; lastScanAt: string | null };
  plan: ProtectionPlan;
  badge: { publicId: string; enabled: boolean; views: number };
  badgePreview: string;
  embeds: { key: string; label: string; code: string }[];
  cfg: string;
  kit: { key: KitKey; count: number }[];
  installed: Record<string, number>;
  online: boolean;
  aiReady: boolean;
  can: { config: boolean; studio: boolean; deploy: boolean };
};

const PAGE: Record<FixPage, string> = { server: "/server", settings: "/settings", scanner: "/scanner", anticheat: "/anticheat", antiraid: "/antiraid", network: "/network" };
const IMPACT = { high: ["Prioritaire", "danger"], medium: ["Important", "warn"], low: ["Bonus", "info"] } as const;

export default function ProtectionView({ status, plan: initialPlan, badge: initialBadge, badgePreview, embeds, cfg, kit, installed: initialInstalled, online, aiReady, can }: Props) {
  const paths = useServerPaths();
  const { toast } = useUI();
  const [plan, setPlan] = useState(initialPlan);
  const [badge, setBadge] = useState(initialBadge);
  const [installed, setInstalled] = useState(initialInstalled);
  const [busy, setBusy] = useState<string | null>(null);
  const level = levelOf(status.level);
  const rank = levelRank(status.level);
  const doneCount = status.checks.filter((c) => c.done).length;

  async function post(action: string, body: unknown) {
    const res = await fetch(paths.api(`protection?action=${action}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: "network" };
    if (!res?.ok) {
      toast(res ? describeApiError(data, res.status) : "Impossible de joindre le panel.", "error");
      return null;
    }
    return data as Record<string, unknown>;
  }

  async function aiPlan() {
    setBusy("plan");
    try {
      const data = await post("plan", {});
      if (data) {
        setPlan(data as unknown as ProtectionPlan);
        toast("Plan personnalisé par l'IA.", "ok");
      }
    } finally {
      setBusy(null);
    }
  }

  async function install(key: KitKey, deploy: boolean) {
    setBusy(`${key}:${deploy}`);
    try {
      const data = await post("kit", { key, deploy });
      if (data) {
        setInstalled((m) => ({ ...m, [key]: Number(data.creationId) }));
        toast(deploy ? `${key} envoyé au serveur : ajoute « ensure ${key} » dans server.cfg pour qu'il redémarre avec lui.` : `${key} ajouté à ton Studio.`, "ok");
      }
    } finally {
      setBusy(null);
    }
  }

  async function toggleBadge(enabled: boolean) {
    setBusy("badge");
    try {
      const data = await post("badge", { enabled });
      if (data) {
        setBadge((b) => ({ ...b, enabled }));
        toast(enabled ? "Badge public activé." : "Badge public désactivé.", "ok");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="gx-level rise rise-1" style={{ "--lvl": level.color } as React.CSSProperties}>
        <div className="gx-level-badge" dangerouslySetInnerHTML={{ __html: badgePreview }} />
        <div className="gx-level-main">
          <div className="eyebrow">Niveau actuel</div>
          <h2>{status.level === "none" ? "Pas encore protégé" : level.label}</h2>
          <p className="muted">
            {status.next
              ? <>Encore <b>{status.next.missing.length}</b> point{status.next.missing.length > 1 ? "s" : ""} pour passer <b style={{ color: levelOf(status.next.level).color }}>{levelOf(status.next.level).label}</b>.</>
              : "Niveau maximum : ton serveur coche toutes les cases."}
            {status.lastScanAt && <> Dernier scan : {formatDateTime(status.lastScanAt)}{status.score !== null && <>, score {status.score}/100</>}.</>}
          </p>
          <div className="gx-track" aria-label={`${doneCount} vérifications sur ${status.checks.length}`}>
            {LEVELS.slice(1).map((l) => <i key={l.key} data-on={rank >= levelRank(l.key)} style={{ "--lvl": l.color } as React.CSSProperties}><span>{l.label}</span></i>)}
          </div>
        </div>
      </section>

      <section className="gx-checks rise rise-2">
        {LEVELS.slice(1).map((l) => (
          <div key={l.key} className="gx-check-col" data-reached={rank >= levelRank(l.key)} style={{ "--lvl": l.color } as React.CSSProperties}>
            <header><ShieldCheck size={16} /><b>{l.label}</b></header>
            {status.checks.filter((c) => c.level === l.key).map((c) => (
              <div key={c.key} className="gx-check" data-done={c.done}>
                {c.done ? <Check size={15} /> : <Circle size={15} />}
                <div>
                  <b>{c.label}</b>
                  {!c.done && <p>{c.hint}</p>}
                  {!c.done && <Link href={paths.page(PAGE[c.page])} className="linkish">Corriger<ArrowRight size={12} /></Link>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="sect">
        <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h2 className="h2">Ton plan d&apos;action</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>{plan.summary}</p>
          </div>
          {aiReady && (
            <button className="btn" disabled={busy === "plan"} onClick={aiPlan}>
              <Wand2 size={15} />{busy === "plan" ? "L'IA réfléchit…" : plan.source === "ai" ? "Refaire avec l'IA" : "Personnaliser avec l'IA"}
            </button>
          )}
        </header>
        {plan.source === "ai" && <small className="muted"><Sparkles size={12} /> Écrit par l&apos;IA le {formatDateTime(plan.createdAt)} pour le dernier scan.</small>}
        <ol className="gx-steps">
          {plan.steps.map((s, i) => (
            <li key={i} data-impact={s.impact}>
              <div>
                <b>{s.title}</b>
                <span className="tag" data-tone={IMPACT[s.impact][1]}>{IMPACT[s.impact][0]}</span>
                <span className="tag">{s.effort}</span>
              </div>
              {s.why && <p className="muted">{s.why}</p>}
              <p>{s.how}</p>
              <div className="gx-step-actions">
                {s.page && <Link href={paths.page(PAGE[s.page])} className="btn sm">Ouvrir<ArrowRight size={13} /></Link>}
                {s.kit && can.studio && (
                  installed[s.kit]
                    ? <Link href={paths.page(`/studio/script/${installed[s.kit]}`)} className="btn sm"><Package size={13} />{s.kit}</Link>
                    : <button className="btn sm" disabled={busy !== null} onClick={() => install(s.kit as KitKey, false)}><Package size={13} />Ajouter {s.kit}</button>
                )}
              </div>
            </li>
          ))}
        </ol>
        {plan.steps.length === 0 && <p className="muted">Rien à faire pour l&apos;instant.</p>}
      </section>

      <section className="sect">
        <header>
          <h2 className="h2">Kit de protection</h2>
          <p className="muted" style={{ margin: "6px 0 0" }}>Des ressources écrites par Fiverax, lisibles et sans dépendance, à installer en un clic sur ton serveur (dossier <code>[fiverax_studio]</code>).</p>
        </header>
        <div className="gx-kit">
          {KIT.map((k) => {
            const rec = kit.find((x) => x.key === k.key);
            const id = installed[k.key];
            return (
              <article key={k.key} data-recommended={Boolean(rec?.count)}>
                <div className="gx-kit-head">
                  <h3>{k.title}</h3>
                  {rec && rec.count > 0 && <span className="tag" data-tone="warn">Recommandé · {rec.count} problème{rec.count > 1 ? "s" : ""}</span>}
                  {id && <span className="tag" data-tone="up">Dans ton Studio</span>}
                </div>
                <code className="gx-kit-name">{k.key}</code>
                <p>{k.text}</p>
                <pre className="gx-code small">{k.usage}</pre>
                <div className="gx-step-actions">
                  {can.deploy && (
                    <button className="btn sm primary" disabled={busy !== null || !online} title={online ? undefined : "Serveur FiveM hors ligne"} onClick={() => install(k.key, true)}>
                      <Rocket size={13} />{busy === `${k.key}:true` ? "Envoi…" : "Installer sur le serveur"}
                    </button>
                  )}
                  {can.studio && !id && <button className="btn sm" disabled={busy !== null} onClick={() => install(k.key, false)}><Package size={13} />Ajouter au Studio</button>}
                  {id && <Link href={paths.page(`/studio/script/${id}`)} className="btn sm">Ouvrir dans le Studio</Link>}
                  {id && <a href={paths.api(`studio/${id}/zip`)} className="btn sm"><Download size={13} />.zip</a>}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="sect">
        <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h2 className="h2">server.cfg recommandé</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>Les lignes qui corrigent les problèmes de configuration du dernier scan. Colle-les puis redémarre le serveur.</p>
          </div>
          <CopyText text={cfg} label="Copier" />
        </header>
        <pre className="gx-code">{cfg}</pre>
      </section>

      <section className="sect">
        <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h2 className="h2"><BadgeCheck size={18} style={{ verticalAlign: -3, marginRight: 6 }} />Badge « Protégé par Fiverax »</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Montre à tes joueurs que ton serveur est sûr : le badge affiche ton niveau et ton score, toujours à jour, et mène à une page de vérification publique
              (jamais le détail des problèmes). Il apparaît aussi sur ta fiche annuaire, et les serveurs protégés remontent dans le classement.
            </p>
          </div>
          {can.config && (
            <label className="check">
              <input type="checkbox" checked={badge.enabled} disabled={busy === "badge"} onChange={(e) => toggleBadge(e.target.checked)} />
              Badge public {badge.enabled ? "activé" : "désactivé"}
            </label>
          )}
        </header>
        {!badge.enabled && <div className="banner">Le badge est désactivé : la page publique et l&apos;image ne montrent rien de ton serveur.{status.level === "none" ? " Atteins d'abord le niveau Protégé (la checklist plus haut)." : ""}</div>}
        {badge.enabled && (
          <p className="muted" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <a href={`/protection/${badge.publicId}`} target="_blank" rel="noopener" className="linkish">Page de vérification<ExternalLink size={12} /></a>
            <span>{badge.views} visite{badge.views > 1 ? "s" : ""} de la page</span>
          </p>
        )}
        <div className="gx-embeds">
          {embeds.map((e) => (
            <div key={e.key}>
              <div className="gx-embed-head"><b>{e.label}</b><CopyText text={e.code} /></div>
              <pre className="gx-code small">{e.code}</pre>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
