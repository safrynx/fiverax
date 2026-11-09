import { gradeOf } from "./external-scan-shared";
import { AC_ACTION_LABELS, DETECTIONS, detectionLabel, riskWeight, type AnticheatSettings } from "./security-config";

/**
 * Security intelligence, pure (no DB): tuning advice from what the staff marked as false positives, the risk score of
 * a player, and the overall posture of a server (code, game, Discord, response). Client-safe.
 */

// ---- tuning advice ----

export type KindStats = { kind: string; total: number; dismissed: number; confirmed: number; players: number };
export type Advice = { kind: string; tone: "warn" | "up" | "info"; title: string; text: string };

/** The limit that drives each detection, to point at the right setting. */
const LIMIT_OF: Record<string, [keyof AnticheatSettings["limits"], string]> = {
  teleport: ["teleportDistance", "Saut de téléportation"], speedhack: ["footSpeed", "Vitesse max à pied"], damage_distance: ["damageDistance", "Distance de tir max"],
  vehicle_speed: ["vehicleSpeed", "Vitesse max des véhicules"], noclip: ["noclipDistance", "Distance du noclip"], entity_spam: ["entitiesPer10s", "Entités créées"],
  explosion_spam: ["explosionsPer10s", "Explosions"], ptfx_spam: ["ptfxPer10s", "Particules"], projectile_spam: ["projectilesPer10s", "Projectiles"],
  event_spam: ["eventsPer10s", "Événements protégés"], damage_spam: ["damagePer10s", "Coups en 10 s"], kill_spam: ["killsPer10s", "Kills en 10 s"]
};

/**
 * Pure: what to change, from the last days of detections. Many false positives on a detection that punishes →
 * lower its action or raise its limit; confirmed cheats only on one that just records → it can punish; one detection
 * hitting many players and nobody reviewing → probably one of the server's own scripts.
 */
export function tuningAdvice(stats: KindStats[], settings: AnticheatSettings): Advice[] {
  const out: (Advice & { rank: number })[] = [];
  for (const s of stats) {
    const def = DETECTIONS.find((d) => d.key === s.kind);
    if (!def || s.kind === "connection_refused" || s.kind === "ai_screenshot") continue;
    const action = settings.detections[def.key]?.action ?? "off";
    const reviewed = s.dismissed + s.confirmed;
    const falseRate = reviewed ? s.dismissed / reviewed : 0;
    const limit = LIMIT_OF[s.kind];
    const limitHint = limit ? ` ou monte « ${limit[1]} » (actuellement ${settings.limits[limit[0]]})` : "";
    if (s.dismissed >= 3 && falseRate >= 0.5 && (action === "kick" || action === "ban")) {
      out.push({
        kind: s.kind, tone: "warn", rank: 0,
        title: `${def.label} : ${Math.round(falseRate * 100)} % de faux positifs`,
        text: `${s.dismissed} détection${s.dismissed > 1 ? "s" : ""} marquée${s.dismissed > 1 ? "s" : ""} « faux positif » alors qu'elle ${action === "ban" ? "bannit" : "expulse"} : passe-la en « Signaler »${limitHint}.`
      });
    } else if (s.dismissed >= 3 && falseRate >= 0.5) {
      out.push({
        kind: s.kind, tone: "info", rank: 2,
        title: `${def.label} : surtout des faux positifs`,
        text: limit ? `Monte « ${limit[1]} » (actuellement ${settings.limits[limit[0]]}) : un de tes scripts déclenche probablement cette détection.` : "Un de tes scripts déclenche probablement cette détection : désactive-la si elle ne t'apporte rien."
      });
    } else if (s.confirmed >= 3 && s.dismissed === 0 && action === "log") {
      out.push({
        kind: s.kind, tone: "up", rank: 1,
        title: `${def.label} : ${s.confirmed} cheats confirmés, aucun faux positif`,
        text: `Elle ne fait que signaler : passe-la en « ${AC_ACTION_LABELS.kick} » pour sortir les cheaters automatiquement.`
      });
    } else if (s.total >= 20 && s.players >= 8 && reviewed === 0) {
      out.push({
        kind: s.kind, tone: "info", rank: 3,
        title: `${def.label} : ${s.total} détections sur ${s.players} joueurs`,
        text: "Autant de joueurs différents, c'est souvent un script du serveur : examine quelques détections (confirmer ou faux positif) pour que Fiverax t'indique le bon réglage."
      });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, 5).map(({ rank: _rank, ...a }) => a);
}

// ---- player risk ----

export type RiskInput = { detections: { kind: string; status: string }[]; aiCheat: number; aiSuspicious: number };

/**
 * Pure: 0 to 100, from a player's recent journal. Each detection counts its risk weight (confirmed ×1.5, false
 * positives and refused connections not at all), AI verdicts on their screenshots on top. Saturates smoothly.
 */
export function riskScore(input: RiskInput): number {
  let points = 0;
  for (const d of input.detections) {
    if (d.status === "dismissed" || d.kind === "connection_refused") continue;
    points += riskWeight(d.kind) * (d.status === "confirmed" ? 1.5 : 1);
  }
  points += input.aiCheat * 6 + input.aiSuspicious * 2;
  return Math.min(100, Math.round(100 * (1 - Math.exp(-points / 12))));
}

export const riskTier = (score: number) => (score >= 70 ? "high" : score >= 40 ? "medium" : "low");

/** Pure: "Noclip ×3, Téléportation" — the kinds of a player's detections, most frequent first. */
export function topKinds(detections: { kind: string; status: string }[], max = 3): string {
  const counts = new Map<string, number>();
  for (const d of detections) if (d.status !== "dismissed") counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k, n]) => `${detectionLabel(k)}${n > 1 ? ` ×${n}` : ""}`).join(", ");
}

// ---- posture ----

export type PostureInput = {
  /** Last full scan of the code (null: never). */
  scan: { score: number; ageDays: number } | null;
  anticheatStrength: number;
  agentOnline: boolean;
  guildLinked: boolean;
  botOnline: boolean;
  antiraidEnabled: boolean;
  antiraidObserve: boolean;
  /** Last Discord audit (null: never). */
  discordScore: number | null;
  alerts: boolean;
  backupRecent: boolean;
  network: boolean;
};

export type PillarKey = "code" | "game" | "discord" | "response";
export type Pillar = { key: PillarKey; label: string; score: number; weight: number; tone: "good" | "warn" | "bad"; summary: string; page: string; cta: string };
export type Posture = { score: number; grade: string; pillars: Pillar[]; weakest: Pillar };

const tone = (score: number): Pillar["tone"] => (score >= 80 ? "good" : score >= 50 ? "warn" : "bad");

/**
 * Pure: the server's overall security, out of 100: its code (full scan, 30 %), the game (anticheat strength while the
 * agent runs, 25 %), Discord (anti-raid and permissions audit, 25 %), and how fast the staff hears and recovers
 * (alerts, backups, shared bans, 20 %). Something missing counts as 0: an unprotected side is the one attacked.
 */
export function posture(i: PostureInput): Posture {
  const scanFresh = i.scan && i.scan.ageDays <= 30;
  const code = i.scan ? Math.round(i.scan.score * (scanFresh ? 1 : 0.5)) : 0;
  const game = i.agentOnline ? i.anticheatStrength : 0;
  const raid = !i.guildLinked || !i.botOnline || !i.antiraidEnabled ? 0 : i.antiraidObserve ? 20 : 50;
  const discord = i.guildLinked ? Math.round(raid + (i.discordScore ?? 0) * 0.5) : 0;
  // Backups only exist with a Discord: without one, alerts and shared bans make the whole of it.
  const responseGot = (i.alerts ? 40 : 0) + (i.network ? 30 : 0) + (i.guildLinked && i.backupRecent ? 30 : 0);
  const response = Math.round((responseGot / (i.guildLinked ? 100 : 70)) * 100);

  const pillars: Pillar[] = [
    {
      key: "code", label: "Code du serveur", score: code, weight: 0.3, tone: tone(code), page: "scanner", cta: i.scan ? "Relancer le scan" : "Lancer le scan complet",
      summary: !i.scan ? "Aucun scan complet : backdoors et événements exploitables inconnus." : scanFresh ? `Scan complet ${i.scan.score}/100.` : `Scan de plus de 30 jours (${i.scan.score}/100) : compte pour moitié.`
    },
    {
      key: "game", label: "Anticheat en jeu", score: game, weight: 0.25, tone: tone(game), page: "anticheat", cta: i.agentOnline ? "Renforcer" : "Installer l'agent",
      summary: !i.agentOnline ? "Agent FiveM hors ligne : aucune détection en jeu." : `Réglages couvrant ${i.anticheatStrength} % des menaces suivies.`
    },
    {
      key: "discord", label: "Discord", score: discord, weight: 0.25, tone: tone(discord), page: "antiraid", cta: i.discordScore === null ? "Auditer le Discord" : "Voir l'audit",
      summary: !i.guildLinked ? "Aucun serveur Discord relié." : !i.botOnline ? "Bot hors ligne : le Discord n'est pas protégé." : !i.antiraidEnabled ? "Anti-raid désactivé : un nuke ne serait pas annulé." : `${i.antiraidObserve ? "Anti-raid en observation" : "Anti-raid actif"}${i.discordScore !== null ? `, permissions ${i.discordScore}/100` : ", permissions jamais auditées"}.`
    },
    {
      key: "response", label: "Réaction", score: response, weight: 0.2, tone: tone(response), page: i.alerts ? "network" : "anticheat", cta: i.alerts ? "Bans partagés" : "Activer les alertes",
      summary: [i.alerts ? "alertes Discord" : "pas d'alertes", i.guildLinked ? (i.backupRecent ? "sauvegarde récente" : "pas de sauvegarde récente") : null, i.network ? "bans partagés" : "hors réseau"].filter(Boolean).join(" · ")
    }
  ];
  const score = Math.round(pillars.reduce((n, p) => n + p.score * p.weight, 0));
  const weakest = [...pillars].sort((a, b) => a.score * a.weight - b.score * b.weight || a.score - b.score)[0];
  return { score, grade: gradeOf(score), pillars, weakest };
}

// ---- scanner → anticheat ----

/** Pure: server events the full scan found exploitable (« name » in the finding), to protect them against spam. */
export function exploitableEvents(findings: { rule: string; detail: string }[]): string[] {
  const out = new Set<string>();
  for (const f of findings) {
    if (f.rule !== "trusted_event" && f.rule !== "unchecked_reward") continue;
    const name = /«\s*([^»]+?)\s*»/.exec(f.detail)?.[1];
    if (name && name.length <= 100 && /^[\w:.\-/]+$/.test(name)) out.add(name);
  }
  return [...out].slice(0, 100);
}
