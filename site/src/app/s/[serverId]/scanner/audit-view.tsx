"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Copy, Lock, Play, Search, Sparkles } from "lucide-react";
import { CATEGORIES, SEVERITIES, SEVERITY_LABEL, type AIReview, type Category, type Finding, type Severity } from "@/lib/audit-rules";
import type { AuditSettings, Scan, ScanSummary } from "@/lib/server-audit";
import { formatDateTime } from "@/lib/format";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

type State = { running: ScanSummary | null; latest: Scan | null; history: ScanSummary[] };
type Props = { initial: State; settings: AuditSettings; online: boolean; canRun: boolean; aiReady: boolean };

const TONE: Record<Severity, string> = { critical: "danger", high: "warn", medium: "info", info: "neutral" };
const tier = (score: number) => (score >= 80 ? ["Bon", "var(--ok)"] : score >= 50 ? ["À améliorer", "var(--warn)"] : ["Risqué", "var(--bad)"]) as [string, string];

export default function AuditView({ initial, settings: initialSettings, online, canRun, aiReady }: Props) {
  const paths = useServerPaths();
  const { toast } = useUI();
  const [state, setState] = useState(initial);
  const [settings, setSettings] = useState(initialSettings);
  const [busy, setBusy] = useState(false);
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [category, setCategory] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const report = state.latest?.report ?? null;

  // While a scan runs: follow it, then show its report.
  useEffect(() => {
    if (!state.running) return;
    const timer = setInterval(async () => {
      const next = await fetch(paths.api("audit")).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!next) return;
      setState(next as State);
      if (!next.running) {
        const failed = (next.history as ScanSummary[])[0];
        if (failed?.status === "failed") toast(failed.error ?? "Le scan a échoué.", "error");
        else toast("Scan terminé.", "ok");
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [state.running, paths, toast]);

  async function post(action: string, body: unknown) {
    const res = await fetch(paths.api(`audit?action=${action}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: "network" };
    if (!res?.ok) {
      toast(res ? describeApiError(data, res.status) : "Impossible de joindre le panel.", "error");
      return null;
    }
    return data as Record<string, unknown>;
  }

  async function run() {
    setBusy(true);
    try {
      const data = await post("run", {});
      if (data) {
        toast("Scan lancé : l'agent inventorie les ressources.", "info");
        setState((s) => ({ ...s, running: { id: Number(data.scanId), status: "pending", trigger: "manual", createdAt: new Date().toISOString(), finishedAt: null, score: null, counts: { critical: 0, high: 0, medium: 0, info: 0 }, error: null, progress: "En attente de l'agent…" } }));
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(next: AuditSettings) {
    setSettings(next);
    if (await post("settings", next)) toast("Réglages enregistrés.", "ok");
  }

  async function open(id: number) {
    const scan = await fetch(paths.api(`audit?scan=${id}`)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (scan) setState((s) => ({ ...s, latest: scan as Scan }));
  }

  const setReview = (index: number, ai: AIReview) =>
    setState((s) => {
      if (!s.latest?.report) return s;
      const findings = [...s.latest.report.findings];
      findings[index] = { ...findings[index], ai };
      return { ...s, latest: { ...s.latest, report: { ...s.latest.report, findings } } };
    });

  // Findings kept with their index in the report (the AI answer is stored at that index), grouped by rule.
  const groups = useMemo(() => {
    if (!report) return [];
    const needle = query.trim().toLowerCase();
    const map = new Map<string, { rule: string; severity: Severity; title: string; fix: string; items: { f: Finding; index: number }[] }>();
    report.findings.forEach((f, index) => {
      if (severity !== "all" && f.severity !== severity) return;
      if (category !== "all" && f.category !== category) return;
      if (needle && !`${f.title} ${f.resource ?? ""} ${f.file ?? ""} ${f.detail}`.toLowerCase().includes(needle)) return;
      const g = map.get(f.rule) ?? { rule: f.rule, severity: f.severity, title: f.title, fix: f.fix, items: [] };
      g.items.push({ f, index });
      map.set(f.rule, g);
    });
    return [...map.values()];
  }, [report, severity, category, query]);

  const done = state.history.filter((h) => h.status === "done" && h.score !== null).reverse();

  return (
    <>
      <div className="audit-bar rise rise-1">
        {canRun && (
          <button className="btn primary" disabled={busy || Boolean(state.running) || !online} onClick={run} title={online ? undefined : "Serveur FiveM hors ligne"}>
            <Play size={14} />{state.running ? "Scan en cours…" : "Lancer un scan"}
          </button>
        )}
        {state.running && <span className="tag" data-tone="warn">{state.running.progress ?? "En attente de l'agent…"}</span>}
        {canRun && (
          <>
            <label className="check"><input type="checkbox" checked={settings.continuous} onChange={(e) => saveSettings({ ...settings, continuous: e.target.checked })} />Scan continu (à chaque ressource démarrée)</label>
            <label className="check"><input type="checkbox" checked={settings.alert} onChange={(e) => saveSettings({ ...settings, alert: e.target.checked })} />Alerte Discord sur un nouveau problème grave</label>
          </>
        )}
      </div>

      {!report && !state.running && (
        <div className="audit-empty rise rise-2">
          <Search size={22} />
          <p>Aucun scan pour l&apos;instant.{canRun ? " Lance le premier : l'agent liste les ressources, le panel analyse leur code et calcule le score." : ""}</p>
          <small className="muted">Nécessite fiverax_agent 3.3 sur le serveur FiveM.</small>
        </div>
      )}

      {report && state.latest && (
        <>
          <div className="audit-top rise rise-2">
            <ScoreRing score={report.score} />
            <div className="audit-cats">
              {CATEGORIES.map((c) => {
                const cat = report.categories[c.key];
                return (
                  <button key={c.key} type="button" className="audit-cat" data-on={category === c.key} onClick={() => setCategory(category === c.key ? "all" : c.key)}>
                    <div className="audit-cat-head"><b>{c.label}</b><span style={{ color: tier(cat.score)[1] }}>{cat.score}</span></div>
                    <div className="audit-meter"><i style={{ width: `${cat.score}%`, background: tier(cat.score)[1] }} /></div>
                    <small className="muted">{SEVERITIES.filter((s) => cat.counts[s]).map((s) => `${cat.counts[s]} ${SEVERITY_LABEL[s].toLowerCase()}`).join(" · ") || "Rien à signaler"}</small>
                  </button>
                );
              })}
            </div>
            <div className="audit-side">
              <small className="eyebrow">Scan du {formatDateTime(state.latest.createdAt)}{state.latest.trigger === "auto" ? " · automatique" : ""}</small>
              <div className="audit-stats">
                <span><b>{report.stats.resources}</b> ressources</span>
                <span><b>{report.stats.code}</b> fichiers de code</span>
                <span><b>{report.stats.analyzed}</b> analysés</span>
                {report.stats.protected > 0 && <span><b>{report.stats.protected}</b> protégées</span>}
                {report.stats.skipped > 0 && <span><b>{report.stats.skipped}</b> non analysés</span>}
              </div>
              {done.length > 1 && <Spark scores={done.map((d) => d.score as number)} />}
            </div>
          </div>

          <div className="filters rise rise-3" style={{ marginTop: 26 }}>
            <div className="pill-tabs">
              <a href="#" data-on={severity === "all"} onClick={(e) => { e.preventDefault(); setSeverity("all"); }}>Tout · {report.findings.length}</a>
              {SEVERITIES.map((s) => {
                const n = report.findings.filter((f) => f.severity === s).length;
                return n ? <a key={s} href="#" data-on={severity === s} onClick={(e) => { e.preventDefault(); setSeverity(s); }}>{SEVERITY_LABEL[s]} · {n}</a> : null;
              })}
            </div>
            <input className="field" placeholder="Ressource, fichier, problème…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
            {category !== "all" && <button className="btn sm" onClick={() => setCategory("all")}>Toutes les catégories</button>}
          </div>

          {groups.length === 0 && <p className="muted">Aucun problème avec ces filtres.</p>}
          <div className="audit-groups">
            {groups.map((g) => (
              <Group key={g.rule} group={g} scanId={state.latest!.id} aiReady={aiReady} onReview={setReview} />
            ))}
          </div>
        </>
      )}

      {state.history.length > 0 && (
        <section className="sect">
          <header><h2 className="h2">Historique</h2></header>
          <div className="audit-history">
            {state.history.map((h) => (
              <button key={h.id} type="button" disabled={h.status !== "done"} data-on={state.latest?.id === h.id} onClick={() => open(h.id)}>
                <span>{formatDateTime(h.createdAt)}{h.trigger === "auto" ? " · auto" : ""}</span>
                {h.status === "done" ? <b style={{ color: tier(h.score ?? 0)[1] }}>{h.score}/100</b> : <span className="tag" data-tone={h.status === "failed" ? "danger" : "warn"} title={h.error ?? undefined}>{h.status === "failed" ? "Échec" : "En cours"}</span>}
                {h.status === "done" && <small className="muted">{h.counts.critical} crit. · {h.counts.high} hautes</small>}
              </button>
            ))}
          </div>
        </section>
      )}

      <p className="muted audit-privacy">
        <Lock size={12} /> Le code n&apos;est jamais conservé : chaque fichier est analysé puis oublié. Le panel garde seulement les empreintes SHA-256, les résultats et 3 lignes autour de chaque problème.
        Un fichier déjà analysé (même contenu, sur n&apos;importe quel serveur) n&apos;est plus envoyé. <code>set fiverax_audit_code 0</code> : mode confidentiel, aucun code ne quitte le serveur (seuls les fichiers déjà connus sont évalués).
        L&apos;IA ne reçoit que les 3 lignes du problème, à la demande. Les ressources protégées par l&apos;escrow Tebex sont chiffrées : elles ne sont pas analysables.
      </p>
    </>
  );
}

function ScoreRing({ score }: { score: number }) {
  const [label, color] = tier(score);
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="audit-ring">
      <svg viewBox="0 0 120 120" width={150} height={150} role="img" aria-label={`Score ${score} sur 100`}>
        <circle cx={60} cy={60} r={r} fill="none" stroke="var(--line-2)" strokeWidth={9} />
        <circle cx={60} cy={60} r={r} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 60 60)" />
        <text x={60} y={60} textAnchor="middle" dominantBaseline="central" className="audit-ring-num">{score}</text>
        <text x={60} y={86} textAnchor="middle" className="audit-ring-sub">/ 100</text>
      </svg>
      <b style={{ color }}>{label}</b>
    </div>
  );
}

function Spark({ scores }: { scores: number[] }) {
  const w = 220;
  const h = 46;
  const pts = scores.map((s, i) => `${(i / Math.max(1, scores.length - 1)) * (w - 8) + 4},${h - 4 - (s / 100) * (h - 8)}`).join(" ");
  const last = scores[scores.length - 1];
  const delta = last - scores[scores.length - 2];
  return (
    <div className="audit-spark">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`Évolution du score : ${scores.join(", ")}`}>
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
      </svg>
      <small className="muted">{delta === 0 ? "Stable" : delta > 0 ? `+${delta} depuis le scan précédent` : `${delta} depuis le scan précédent`}</small>
    </div>
  );
}

type GroupData = { rule: string; severity: Severity; title: string; fix: string; items: { f: Finding; index: number }[] };

function Group({ group, scanId, aiReady, onReview }: { group: GroupData; scanId: number; aiReady: boolean; onReview: (index: number, ai: AIReview) => void }) {
  const [open, setOpen] = useState(group.severity === "critical" || group.severity === "high");
  const [shown, setShown] = useState(20);
  return (
    <div className="audit-group" data-severity={group.severity}>
      <button type="button" className="audit-group-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="tag" data-tone={TONE[group.severity]}>{SEVERITY_LABEL[group.severity]}</span>
        <b>{group.title}</b>
        <span className="muted">{group.items.length > 1 ? `× ${group.items.length}` : group.items[0].f.resource ?? ""}</span>
        <ChevronDown size={15} style={{ marginLeft: "auto", transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
      </button>
      {open && (
        <div className="audit-group-body">
          <div className="audit-fix"><small className="eyebrow">Correctif</small><p>{group.fix}</p></div>
          {group.items.slice(0, shown).map(({ f, index }) => <Occurrence key={index} f={f} index={index} scanId={scanId} aiReady={aiReady} onReview={onReview} />)}
          {group.items.length > shown && <button className="btn sm" onClick={() => setShown(shown + 50)}>Voir {Math.min(50, group.items.length - shown)} de plus</button>}
        </div>
      )}
    </div>
  );
}

const VERDICT: Record<AIReview["verdict"], [string, string]> = {
  confirmed: ["Confirmé par l'IA", "danger"],
  false_positive: ["Faux positif selon l'IA", "up"],
  uncertain: ["À vérifier", "warn"]
};

function Occurrence({ f, index, scanId, aiReady, onReview }: { f: Finding; index: number; scanId: number; aiReady: boolean; onReview: (index: number, ai: AIReview) => void }) {
  const paths = useServerPaths();
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const where = [f.resource, f.file && `${f.file}${f.line ? `:${f.line}` : ""}`].filter(Boolean).join(" / ");

  async function explain() {
    setBusy(true);
    try {
      const res = await fetch(paths.api("audit?action=explain"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scanId, index }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast(describeApiError(data, res.status), "error");
      else onReview(index, data as AIReview);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copié.", "ok");
    } catch {
      toast("Copie impossible ici.", "error");
    }
  }

  return (
    <div className="audit-occ">
      <div className="audit-occ-head">
        {where && <code>{where}</code>}
        {f.detail && <span>{f.detail}</span>}
      </div>
      {f.snippet && <pre className="audit-code">{f.snippet}</pre>}
      {f.ai ? (
        <div className="audit-ai">
          <span className="tag" data-tone={VERDICT[f.ai.verdict][1]}><Sparkles size={11} /> {VERDICT[f.ai.verdict][0]}</span>
          <p>{f.ai.explanation}</p>
          {f.ai.fix && (
            <div style={{ position: "relative" }}>
              <pre className="audit-code">{f.ai.fix}</pre>
              <button type="button" className="ibtn audit-copy" title="Copier le correctif" onClick={() => copy(f.ai!.fix!)}><Copy size={13} /></button>
            </div>
          )}
        </div>
      ) : (
        aiReady && f.snippet && (
          <button className="btn sm" disabled={busy} onClick={explain}><Sparkles size={13} />{busy ? "L'IA regarde…" : "Expliquer et corriger avec l'IA"}</button>
        )
      )}
    </div>
  );
}
