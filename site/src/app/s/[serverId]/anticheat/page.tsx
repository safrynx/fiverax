import Link from "next/link";
import { can, requirePermissionPage } from "@/lib/auth";
import { Lightbulb, TrendingUp, TriangleAlert } from "lucide-react";
import { detectionStats, getSecuritySettings, listDetections, listScreenshots, securityOverview } from "@/lib/security";
import { AC_PRESETS, anticheatStrength, DETECTIONS, presetOf } from "@/lib/security-config";
import { exploitableEvents, tuningAdvice } from "@/lib/security-insights";
import { latestReport } from "@/lib/server-audit";
import { visionConfigured } from "@/lib/vision";
import Shell, { PageHead } from "@/app/shell";
import { AutoRefresh } from "../security-actions";
import { getLiveState } from "@/lib/agent";
import { recentDetectionsByPlayer } from "@/lib/screen-watch";
import AnticheatSettingsForm from "./settings-form";
import DetectionList from "./detection-list";
import ScreenWall, { type WallPlayer } from "./screen-wall";
import ScreenshotGrid from "./screenshot-grid";
import "@/app/security.css";

export const dynamic = "force-dynamic";

const TABS = [["detections", "Détections"], ["screens", "Écrans en direct"], ["screenshots", "Captures IA"], ["settings", "Réglages"]] as const;
type Tab = (typeof TABS)[number][0];

export default async function AnticheatPage({ params, searchParams }: { params: Promise<{ serverId: string }>; searchParams: Promise<{ tab?: string; kind?: string; status?: string; verdict?: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "view_security");
  const sp = await searchParams;
  const canConfig = can(user, "security_config");
  const canScreen = can(user, "screenshot");
  const allowed = (k: Tab) => (k !== "settings" || canConfig) && (k !== "screens" || canScreen);
  const tab: Tab = TABS.some(([k]) => k === sp.tab) && allowed(sp.tab as Tab) ? (sp.tab as Tab) : "detections";
  const base = `/s/${server.id}/anticheat`;
  const kind = DETECTIONS.some((d) => d.key === sp.kind) ? sp.kind : undefined;
  const status = ["open", "confirmed", "dismissed"].includes(sp.status ?? "") ? sp.status : undefined;
  const verdict = ["cheat", "suspicious", "clean", "error", "skipped", "pending"].includes(sp.verdict ?? "") ? sp.verdict : undefined;

  const [overview, settings, detections, shots, kindStats, scan, live] = await Promise.all([
    securityOverview(server.id),
    getSecuritySettings(server.id),
    tab === "detections" ? listDetections(server.id, { kind, status, limit: 150 }) : Promise.resolve([]),
    tab === "screenshots" ? listScreenshots(server.id, { verdict, limit: 60 }) : Promise.resolve([]),
    tab === "detections" ? detectionStats(server.id, 7) : Promise.resolve([]),
    tab === "settings" ? latestReport(server.id).catch(() => null) : Promise.resolve(null),
    tab === "screens" ? getLiveState(server.id, { watch: true }) : Promise.resolve(null)
  ]);
  const suspicion = live ? await recentDetectionsByPlayer(server.id, live.players.flatMap((p) => (p.playerId ? [p.playerId] : []))) : new Map();
  const wallPlayers: WallPlayer[] = (live?.players ?? []).map((p) => ({
    id: p.id, name: p.name, ping: p.ping, playerId: p.playerId, staff: p.staff?.grade ?? null,
    detections: p.playerId ? suspicion.get(p.playerId)?.count ?? 0 : 0, lastKind: p.playerId ? suspicion.get(p.playerId)?.lastKind ?? null : null
  }));
  const strength = anticheatStrength(settings.anticheat);
  const preset = presetOf(settings.anticheat);
  const advice = canConfig ? tuningAdvice(kindStats, settings.anticheat) : [];

  const stats: [string, string, string][] = [
    ["Détections · 24 h", String(overview.detections24h), settings.anticheat.enabled ? "anticheat actif" : "anticheat désactivé"],
    ["Couverture", `${strength}/100`, preset === "custom" ? "réglages personnalisés" : `préréglage ${AC_PRESETS.find((p) => p.key === preset)?.label}`],
    ["Bans actifs", String(overview.activeBans), "appliqués à la connexion"],
    ["Captures suspectes · 24 h", String(overview.flaggedShots24h), visionConfigured() ? "analysées par l'IA" : "IA non configurée"],
    ["Incidents Discord · 24 h", String(overview.incidents24h), settings.antiraid.enabled ? (settings.antiraid.mode === "observe" ? "anti-raid en observation" : "anti-raid actif") : "anti-raid désactivé"]
  ];
  const tabLink = (t: Tab) => `${base}${t === "detections" ? "" : `?tab=${t}`}`;

  return (
    <Shell user={user} server={server} active="anticheat">
      <PageHead kicker={server.name} title="Anticheat" help="/guides/anticheat">
        Détections côté serveur, protection des événements et captures d&apos;écran analysées par l&apos;IA. Le staff avec l&apos;ACE <code>fiverax.bypass</code> n&apos;est jamais sanctionné.
      </PageHead>
      {tab !== "settings" && <AutoRefresh everyMs={10_000} />}
      {!settings.anticheat.enabled && <div className="banner"><b>L&apos;anticheat est désactivé.</b> L&apos;agent ne fait plus aucune détection (les bans restent appliqués).</div>}

      <div className="strip">
        {stats.map(([label, value, hint], i) => (
          <div key={label} className={`rise rise-${i + 1}`}><div className="eyebrow">{label}</div><div className="num" style={{ fontSize: 24 }}>{value}</div><small>{hint}</small></div>
        ))}
      </div>

      <div className="pill-tabs rise rise-1" style={{ marginBottom: 22 }}>
        {TABS.filter(([k]) => allowed(k)).map(([k, label]) => <Link key={k} href={tabLink(k)} data-on={tab === k}>{label}</Link>)}
      </div>

      {tab === "detections" && (
        <>
          {advice.length > 0 && (
            <section className="ac-advice rise rise-1">
              <header><Lightbulb size={16} /><b>Réglage intelligent</b><span className="muted">d&apos;après les 7 derniers jours et ce que ton staff a marqué</span></header>
              <ul>
                {advice.map((a) => (
                  <li key={a.kind + a.tone} data-tone={a.tone}>
                    {a.tone === "warn" ? <TriangleAlert size={14} /> : a.tone === "up" ? <TrendingUp size={14} /> : <Lightbulb size={14} />}
                    <div><b>{a.title}</b><p>{a.text} <Link href={`${base}?tab=settings`} className="linkish">Régler</Link></p></div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <form className="filters" action={base}>
            <select name="kind" defaultValue={kind ?? ""} className="field">
              <option value="">Toutes les détections</option>
              {DETECTIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <select name="status" defaultValue={status ?? ""} className="field">
              <option value="">Tous les statuts</option>
              <option value="open">À examiner</option>
              <option value="confirmed">Confirmées</option>
              <option value="dismissed">Faux positifs</option>
            </select>
            <button className="btn primary">Filtrer</button>
            {(kind || status) && <Link href={base} className="linkish">Réinitialiser</Link>}
          </form>
          <DetectionList detections={detections} canBan={can(user, "ban")} />
        </>
      )}

      {tab === "screens" && live && <ScreenWall players={wallPlayers} online={live.online} agentLinked={live.linked} />}

      {tab === "screenshots" && (
        <>
          <div className="pill-tabs" style={{ marginBottom: 18 }}>
            {[["", "Toutes"], ["cheat", "Cheat"], ["suspicious", "Suspectes"], ["clean", "Propres"]].map(([v, label]) => (
              <Link key={v} href={`${base}?tab=screenshots${v ? `&verdict=${v}` : ""}`} data-on={(verdict ?? "") === v}>{label}</Link>
            ))}
          </div>
          {!visionConfigured() && <div className="banner"><b>Analyse IA non configurée.</b> Ajoute <code>AI_API_KEY</code> (et éventuellement <code>AI_VISION_MODEL</code>) aux variables d&apos;environnement du site : les captures sont gardées mais pas analysées.</div>}
          <ScreenshotGrid shots={shots} canBan={can(user, "ban")} canAnalyze={can(user, "screenshot")} />
        </>
      )}

      {tab === "settings" && canConfig && <AnticheatSettingsForm initial={settings.anticheat} scannerEvents={exploitableEvents(scan?.report?.findings ?? [])} />}
    </Shell>
  );
}
