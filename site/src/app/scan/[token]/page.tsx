import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Check, CircleHelp, Download, Eye, Lock, RefreshCw, ShieldCheck, Sparkles, TriangleAlert, X } from "lucide-react";
import { getIdentity } from "@/lib/auth";
import { CATEGORIES, SEVERITIES, SEVERITY_LABEL } from "@/lib/audit-rules";
import { getPublicScan, scanContext } from "@/lib/external-scan";
import { gradeOf, lockFindings, type ScanCheck } from "@/lib/external-scan-shared";
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
  const grade = scan ? scan.report.grade ?? gradeOf(scan.score) : null;
  return {
    title: scan ? `Sécurité de ${scan.name ?? "ce serveur"} : ${grade} (${scan.score}/100)` : "Scan introuvable",
    robots: { index: false, follow: false },
    openGraph: scan
      ? { title: `${scan.name} · note de sécurité ${grade} (${scan.score}/100)`, description: "Scan de sécurité gratuit des serveurs FiveM par Fiverax. Teste le tien en 10 secondes." }
      : undefined
  };
}

const TONE = { critical: "danger", high: "warn", medium: "info", info: undefined } as const;
const GROUPS: { key: ScanCheck["group"]; label: string }[] = [
  { key: "config", label: "Configuration" },
  { key: "players", label: "Vie privée des joueurs" },
  { key: "resources", label: "Ressources" },
  { key: "code", label: "Code" }
];
const CHECK_ICON = { pass: Check, fail: X, unknown: CircleHelp, locked: Lock } as const;
const CHECK_HINT = { pass: "Vérifié", fail: "Problème", unknown: "Non visible de l'extérieur", locked: "Scan complet" } as const;

export default async function ScanReportPage({ params }: Props) {
  const { token } = await params;
  const [scan, identity] = await Promise.all([getPublicScan(token), getIdentity()]);
  if (!scan) notFound();
  const { report } = scan;
  const context = await scanContext(scan).catch(() => null);
  const facts = report.facts;
  const grade = report.grade ?? gradeOf(report.score);
  const [, tierColor] = scoreTier(report.score);
  const unlocked = Boolean(identity);
  const problems = report.findings.filter((f) => f.severity !== "info");
  const plan = rulesPlan(report.findings, []);
  const cfg = hardeningCfg(report.findings.map((f) => f.rule));
  const kit = recommendKit(report.findings);
  const login = `/api/auth/discord?next=${encodeURIComponent(`/scan/${token}`)}`;
  const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
  const checks = report.checks ?? [];
  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const exposure = report.exposure;
  const delta = context?.previous ? report.score - context.previous.score : null;

  return (
    <>
      <div style={{ marginTop: 24 }}>
        <Link href="/scan" className="linkish" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}><ArrowLeft size={12} />Nouveau scan</Link>
      </div>

      <section className="gx-report-head">
        <div className="gx-grade-wrap">
          <div className="gx-grade" style={{ ["--tier" as string]: tierColor }} aria-label={`Note ${grade}`}>{grade}</div>
          <ScoreRing score={report.score} size={120} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">Scan rapide · {formatDateTime(scan.createdAt)}</div>
          <h1>{facts.name}</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}><code>{scan.target}</code></p>
          <div className="dir-meta" style={{ marginTop: 12 }}>
            {facts.players !== null && <span><b>{facts.players}</b>{facts.maxClients ? ` / ${facts.maxClients}` : ""} joueurs</span>}
            {facts.build && <span>FXServer <b>{facts.build}</b>{facts.recommendedBuild ? ` (recommandé ${facts.recommendedBuild})` : ""}</span>}
            {facts.framework && <span className="dir-tag">{facts.framework}</span>}
            <span className="dir-tag">{facts.onesyncMode === "legacy" ? "OneSync Legacy" : facts.onesync ? "OneSync" : "Sans OneSync"}</span>
            {facts.txAdmin && <span>txAdmin <b>{facts.txAdmin}</b></span>}
            {facts.resources !== null && <span><b>{facts.resources}</b> ressources publiques</span>}
            {facts.anticheats.length > 0 && <span>Anticheat : <b>{facts.anticheats.join(", ")}</b></span>}
          </div>
          <div className="gx-standing">
            {context?.percentile != null && (
              <span><b>Mieux que {context.percentile} %</b> des {context.servers} serveurs scannés ces 30 jours</span>
            )}
            {delta !== null && context?.previous && (
              <Link href={`/scan/${context.previous.token}`} data-trend={delta > 0 ? "up" : delta < 0 ? "down" : "flat"}>
                {delta > 0 ? <ArrowUpRight size={14} /> : delta < 0 ? <ArrowDownRight size={14} /> : null}
                {delta > 0 ? `+${delta}` : delta} depuis le scan du {formatDateTime(context.previous.at)}
              </Link>
            )}
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
          {exposure && (
            <section className="dir-section" style={{ marginTop: 28 }}>
              <header><h2><Eye size={17} style={{ verticalAlign: -3, marginRight: 8 }} />Ce que n&apos;importe qui voit de ton serveur</h2></header>
              <p className="muted" style={{ marginTop: -8 }}>Un cheater commence toujours par là : il lit ces informations publiques pour savoir quelles failles essayer et qui viser.</p>
              <div className="gx-exposure">
                <div data-bad={exposure.playerIps > 0}>
                  <b>{exposure.playersSampled ? exposure.playerIps : "—"}</b>
                  <span>joueur{exposure.playerIps > 1 ? "s" : ""} avec leur <strong>adresse IP</strong> lisible{exposure.playersSampled ? ` (sur ${exposure.playersSampled} connectés)` : " (liste des joueurs non lue)"}</span>
                </div>
                <div data-bad={exposure.playerIdentifiers > 0}>
                  <b>{exposure.playersSampled ? exposure.playerIdentifiers : "—"}</b>
                  <span>joueur{exposure.playerIdentifiers > 1 ? "s" : ""} avec leurs <strong>comptes</strong> lisibles{exposure.identifierKinds.length ? ` (${exposure.identifierKinds.join(", ")})` : ""}</span>
                </div>
                <div data-bad={exposure.exploitable.length > 0 || exposure.leaked.length > 0}>
                  <b>{exposure.resources ?? "—"}</b>
                  <span>
                    ressources listées{exposure.resources !== null ? "" : " (liste masquée)"}
                    {exposure.exploitable.length > 0 && <>, dont <strong>{exposure.exploitable.length} ciblée{exposure.exploitable.length > 1 ? "s" : ""} par les menus de triche</strong></>}
                    {exposure.leaked.length > 0 && <>, <strong>{exposure.leaked.length} « leak »</strong></>}
                  </span>
                </div>
                <div data-bad={false}>
                  <b>{exposure.versionVisible ? facts.build : "—"}</b>
                  <span>version de FXServer{exposure.txAdmin ? ` et de txAdmin (${exposure.txAdmin})` : ""} visible{exposure.versionVisible ? "" : " : masquée"}</span>
                </div>
              </div>
              {exposure.exploitable.length > 0 && (
                <ul className="gx-exploits">
                  {exposure.exploitable.map((e) => (
                    <li key={e.name}><TriangleAlert size={14} /><code>{e.name}</code><span>{unlocked ? e.why : "connectée à un exploit des menus de triche"}</span></li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="dir-section" style={{ marginTop: exposure ? undefined : 28 }}>
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

          {checks.length > 0 && (
            <section className="dir-section">
              <header><h2>{checks.length} vérifications · {passed} réussie{passed > 1 ? "s" : ""}, {failed} en échec</h2></header>
              <div className="gx-checklist">
                {GROUPS.map((g) => {
                  const items = checks.filter((c) => c.group === g.key);
                  if (!items.length) return null;
                  return (
                    <div key={g.key}>
                      <div className="eyebrow">{g.label}</div>
                      <ul>
                        {items.map((c) => {
                          const Icon = CHECK_ICON[c.status];
                          return (
                            <li key={c.key} data-status={c.status} title={CHECK_HINT[c.status]}>
                              <Icon size={14} />
                              <span>{c.label}{c.note && <small> · {c.note}</small>}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
              {checks.some((c) => c.status === "unknown") && <p className="muted" style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "flex-start" }}><CircleHelp size={13} style={{ flex: "none", marginTop: 2 }} /><span>Point d&apos;interrogation : le serveur ne publie pas cette information (ce qui est plutôt bon signe). Le scan complet la vérifie de l&apos;intérieur.</span></p>}
            </section>
          )}

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
            <h2>Le scan rapide ne voit que la porte</h2>
            <ul className="gx-versus">
              <li><Check size={14} />{checks.length || "Les"} vérifications publiques</li>
              <li><X size={14} />Backdoors cachées dans les ressources</li>
              <li><X size={14} />Événements qui donnent de l&apos;argent</li>
              <li><X size={14} />Webhooks et clés exposés</li>
              <li><X size={14} />Permissions ACE et RCON</li>
              <li><X size={14} />Cheaters en jeu (noclip, godmode, spawn)</li>
              <li><X size={14} />Raids et nukes de ton Discord</li>
            </ul>
            <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>Avec Fiverax : scan complet du code, anticheat serveur, anti-raid Discord et audit de tes permissions. Ton serveur gagne le badge « Protégé par Fiverax ».</p>
            {identity ? <Link href="/servers" className="btn primary">Protéger mon serveur</Link> : <CtaLink href="/login" className="btn primary">Protéger mon serveur</CtaLink>}
          </div>
          <div className="dir-panel">
            <h2>Partager ce rapport</h2>
            <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>Le lien s&apos;affiche avec la note dans Discord. Envoie-le à ton développeur ou à ton équipe.</p>
            <CopyText text={`${appUrl}/scan/${token}`} label="Copier le lien" />
          </div>
          <div className="dir-panel">
            <h2><RefreshCw size={14} style={{ verticalAlign: -2, marginRight: 6 }} />{identity ? "Vérifier une correction" : "Rescanner"}</h2>
            {identity && <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>Corrigé quelque chose ? Relance le scan (une fois par minute) et compare la note.</p>}
            <ScanForm initial={scan.target} compact force={Boolean(identity)} />
          </div>
        </aside>
      </div>
    </>
  );
}
