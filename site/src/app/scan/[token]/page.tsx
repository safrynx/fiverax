import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Download, Lock, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import { getIdentity } from "@/lib/auth";
import { CATEGORIES, SEVERITIES, SEVERITY_LABEL } from "@/lib/audit-rules";
import { getPublicScan } from "@/lib/external-scan";
import { lockFindings } from "@/lib/external-scan-shared";
import { formatDateTime } from "@/lib/format";
import { hardeningCfg, KIT, recommendKit, rulesPlan } from "@/lib/protection-shared";
import { CtaLink } from "../../annuaire/track";
import CopyText from "../../copy-text";
import ScoreRing, { scoreTier } from "../../score-ring";
import ScanForm from "../scan-form";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const scan = await getPublicScan((await params).token);
  return {
    title: scan ? `Sécurité de ${scan.name ?? "ce serveur"} : ${scan.score}/100` : "Scan introuvable",
    robots: { index: false, follow: false },
    openGraph: scan ? { title: `${scan.name} · score de sécurité ${scan.score}/100`, description: "Scan de sécurité gratuit des serveurs FiveM par Fiverax." } : undefined
  };
}

const TONE = { critical: "danger", high: "warn", medium: "info", info: undefined } as const;

export default async function ScanReportPage({ params }: Props) {
  const { token } = await params;
  const [scan, identity] = await Promise.all([getPublicScan(token), getIdentity()]);
  if (!scan) notFound();
  const { report } = scan;
  const facts = report.facts;
  const unlocked = Boolean(identity);
  const problems = report.findings.filter((f) => f.severity !== "info");
  const plan = rulesPlan(report.findings, []);
  const cfg = hardeningCfg(report.findings.map((f) => f.rule));
  const kit = recommendKit(report.findings);
  const login = `/api/auth/discord?next=${encodeURIComponent(`/scan/${token}`)}`;
  const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");

  return (
    <>
      <div style={{ marginTop: 24 }}>
        <Link href="/scan" className="linkish" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}><ArrowLeft size={12} />Nouveau scan</Link>
      </div>

      <section className="gx-report-head">
        <ScoreRing score={report.score} />
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">Scan rapide · {formatDateTime(scan.createdAt)}</div>
          <h1>{facts.name}</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}><code>{scan.target}</code></p>
          <div className="dir-meta" style={{ marginTop: 12 }}>
            {facts.players !== null && <span><b>{facts.players}</b>{facts.maxClients ? ` / ${facts.maxClients}` : ""} joueurs</span>}
            {facts.build && <span>FXServer <b>{facts.build}</b>{facts.recommendedBuild ? ` (recommandé ${facts.recommendedBuild})` : ""}</span>}
            {facts.framework && <span className="dir-tag">{facts.framework}</span>}
            <span className="dir-tag">{facts.onesync ? "OneSync" : "Sans OneSync"}</span>
            {facts.resources !== null && <span><b>{facts.resources}</b> ressources publiques</span>}
            {facts.anticheats.length > 0 && <span>Anticheat : <b>{facts.anticheats.join(", ")}</b></span>}
          </div>
          {facts.fiverax && <div className="gx-note" data-tone="ok"><ShieldCheck size={15} />Ce serveur utilise déjà Fiverax.</div>}
        </div>
        <div className="gx-counts">
          {SEVERITIES.filter((s) => s !== "info").map((s) => (
            <div key={s} data-severity={s}><b>{scan.counts[s]}</b><span>{SEVERITY_LABEL[s].toLowerCase()}{scan.counts[s] > 1 ? "s" : ""}</span></div>
          ))}
        </div>
      </section>

      <div className="audit-cats" style={{ marginTop: 20 }}>
        {CATEGORIES.map((c) => {
          const cat = report.categories[c.key];
          return (
            <div key={c.key} className="audit-cat">
              <div className="audit-cat-head"><b>{c.label}</b><span style={{ color: scoreTier(cat.score)[1] }}>{cat.score}</span></div>
              <div className="audit-meter"><i style={{ width: `${cat.score}%`, background: scoreTier(cat.score)[1] }} /></div>
            </div>
          );
        })}
      </div>

      <div className="dir-layout">
        <div>
          <section className="dir-section" style={{ marginTop: 28 }}>
            <header><h2>{problems.length ? `${problems.length} problème${problems.length > 1 ? "s" : ""} trouvé${problems.length > 1 ? "s" : ""}` : "Aucun problème visible de l'extérieur"}</h2></header>
            <div className="gx-findings">
              {/* Without an account, only the headlines leave the server (lockFindings): no detail, no fix. */}
              {(unlocked ? report.findings : lockFindings(report.findings).map((f) => ({ ...f, detail: "", fix: "" }))).map((f, i) => (
                <details key={`${f.rule}-${i}`} className="gx-finding" data-severity={f.severity} open={unlocked && (f.severity === "critical" || f.severity === "high")}>
                  <summary>
                    <span className="tag" data-tone={TONE[f.severity]}>{SEVERITY_LABEL[f.severity]}</span>
                    <b>{f.title}</b>
                    {!unlocked && <Lock size={13} className="muted" />}
                  </summary>
                  {unlocked ? (
                    <div className="gx-finding-body">
                      {f.detail && <p>{f.detail}</p>}
                      <p className="gx-fix"><Sparkles size={13} />{f.fix}</p>
                    </div>
                  ) : (
                    <div className="gx-finding-body"><p className="muted">Connecte-toi pour voir le détail et le correctif.</p></div>
                  )}
                </details>
              ))}
            </div>
            {!unlocked && (
              <div className="gx-lock">
                <Lock size={20} />
                <div>
                  <b>Débloque le rapport complet</b>
                  <p>Le détail de chaque problème, son correctif, le bloc <code>server.cfg</code> prêt à coller, ton plan d&apos;action et les ressources de protection à installer. Gratuit, connexion Discord en un clic.</p>
                </div>
                <a href={login} className="btn primary shine">Voir le détail</a>
              </div>
            )}
          </section>

          {unlocked && (
            <>
              <section className="dir-section">
                <header><h2>Ton plan d&apos;action</h2></header>
                <p className="muted" style={{ marginTop: -8 }}>{plan.summary}</p>
                <ol className="gx-steps">
                  {plan.steps.map((s, i) => (
                    <li key={i} data-impact={s.impact}>
                      <div><b>{s.title}</b><span className="tag">{s.effort}</span></div>
                      <p>{s.how}</p>
                      {s.kit && <a className="linkish" href={`/api/scan?kit=${s.kit}`}><Download size={12} /> {s.kit}.zip</a>}
                    </li>
                  ))}
                </ol>
              </section>

              <section className="dir-section">
                <header><h2>À ajouter dans server.cfg</h2><CopyText text={cfg} label="Copier" /></header>
                <pre className="gx-code">{cfg}</pre>
              </section>

              <section className="dir-section">
                <header><h2>Kit de protection Fiverax</h2></header>
                <div className="gx-kit">
                  {KIT.filter((k) => kit.some((x) => x.key === k.key)).map((k) => (
                    <article key={k.key}>
                      <h3>{k.title}</h3>
                      <p>{k.text}</p>
                      <a className="btn sm" href={`/api/scan?kit=${k.key}`}><Download size={14} />{k.key}.zip</a>
                    </article>
                  ))}
                </div>
                <p className="muted" style={{ fontSize: 13 }}>Ressources serveur, sans dépendance, compatibles Standalone / ESX / QBCore / Qbox. Avec l&apos;agent Fiverax, elles s&apos;installent en un clic depuis le panel.</p>
              </section>
            </>
          )}
        </div>

        <aside>
          <div className="dir-panel" style={{ background: "radial-gradient(300px 160px at 100% 0%, rgba(var(--accent-rgb), 0.2), transparent 70%), var(--surface)" }}>
            <h2>Le scan rapide ne voit pas tout</h2>
            <ul className="gx-versus">
              <li><Check size={14} />Infos publiques du serveur</li>
              <li><X size={14} />Backdoors cachées dans les ressources</li>
              <li><X size={14} />Événements qui donnent de l&apos;argent</li>
              <li><X size={14} />Webhooks et clés exposés</li>
              <li><X size={14} />Permissions ACE et RCON</li>
            </ul>
            <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>Le scan complet de Fiverax analyse le code de chaque ressource, puis l&apos;IA te dit quoi corriger. Ton serveur gagne le badge « Protégé par Fiverax ».</p>
            {identity ? <Link href="/servers" className="btn primary">Scan complet gratuit</Link> : <CtaLink href="/login" className="btn primary">Scan complet gratuit</CtaLink>}
          </div>
          <div className="dir-panel">
            <h2>Partager ce rapport</h2>
            <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>Envoie-le à ton développeur ou à ton équipe.</p>
            <CopyText text={`${appUrl}/scan/${token}`} label="Copier le lien" />
          </div>
          <div className="dir-panel">
            <h2><RefreshCw size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Rescanner</h2>
            <ScanForm initial={scan.target} compact />
          </div>
        </aside>
      </div>
    </>
  );
}
