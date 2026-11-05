import type { AnticheatSettings } from "./security-config";
import { detectionLabel } from "./security-config";

/** Anticheat alerts posted to the Discord webhook of the settings (best effort: never blocks the agent). */

const RANK = { log: 0, kick: 1, ban: 2 } as const;
const COLORS = { log: 0x7c8aa0, kick: 0xf59e3b, ban: 0xfb7185 } as const;
const ACTION_TEXT = { log: "Signalé", kick: "Kick", ban: "Ban" } as const;

export type Alert = {
  kind: string;
  action: "log" | "kick" | "ban";
  playerName: string;
  details?: Record<string, unknown>;
  /** Link to the player's page on the panel. */
  url?: string | null;
  /** Free text (AI summary…) */
  note?: string | null;
};

/** Pure: should this detection be posted, given the settings? */
export function shouldAlert(settings: AnticheatSettings, alert: Pick<Alert, "kind" | "action">): boolean {
  if (!settings.alerts.webhookUrl) return false;
  if (alert.kind === "ai_screenshot" && settings.alerts.aiCheat) return true;
  return RANK[alert.action] >= RANK[settings.alerts.minAction];
}

export async function sendAnticheatAlert(settings: AnticheatSettings, serverName: string, alert: Alert): Promise<void> {
  if (!shouldAlert(settings, alert) || !settings.alerts.webhookUrl) return;
  const details = Object.entries(alert.details ?? {})
    .filter(([k, v]) => k !== "pos" && v !== null && v !== undefined && typeof v !== "object")
    .map(([k, v]) => `**${k}** : ${String(v).slice(0, 80)}`)
    .join("\n");
  const body = {
    username: "Fiverax Anticheat",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `🛡️ ${detectionLabel(alert.kind)}`,
      url: alert.url ?? undefined,
      color: COLORS[alert.action],
      description: [`**${alert.playerName}** · ${ACTION_TEXT[alert.action]}`, alert.note ?? "", details].filter(Boolean).join("\n").slice(0, 3500),
      footer: { text: serverName },
      timestamp: new Date().toISOString()
    }]
  };
  try {
    await fetch(settings.alerts.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  } catch {
    /* a down webhook must not break the anticheat */
  }
}

/** Reports made in game and ban appeals, posted to the same webhook (when one is set), whatever the minimum action. */
export async function sendReportAlert(settings: AnticheatSettings, serverName: string, alert: { title: string; lines: string[]; url?: string | null }): Promise<void> {
  if (!settings.alerts.webhookUrl) return;
  const body = {
    username: "Fiverax",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: alert.title.slice(0, 200),
      url: alert.url ?? undefined,
      color: 0xd4b06a,
      description: alert.lines.filter(Boolean).join("\n").slice(0, 3500),
      footer: { text: serverName },
      timestamp: new Date().toISOString()
    }]
  };
  try {
    await fetch(settings.alerts.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  } catch {
    /* best effort */
  }
}
