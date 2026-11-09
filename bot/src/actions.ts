import type { Client, Guild } from "discord.js";
import { endLockdown, getAntiraidConfig, report, startLockdown, type Action } from "./antiraid";
import { sitePost } from "./api";
import { restoreBackup, snapshot, type Backup } from "./backup";
import { auditGuild } from "./discord-audit";

/**
 * Actions asked from the panel (lockdown, unlock, backup, restore, Discord audit), fetched every 15 s, the automatic
 * backups (every N hours, setting "backupEveryHours") and the daily Discord security audit.
 */

const POLL_MS = 15_000;
const BACKUP_CHECK_MS = 30 * 60_000;
const AUDIT_EVERY_MS = 24 * 3600_000;

type BotAction = { id: number; guildId: string; kind: "lockdown" | "unlock" | "backup" | "restore" | "audit"; payload: Record<string, unknown> };

export async function backupGuild(guild: Guild, reason: string): Promise<number | null> {
  // Make sure every member is cached (their roles are part of the backup).
  await guild.members.fetch().catch(() => undefined);
  const result = await sitePost<{ id?: number }>("backup", { op: "store", guildId: guild.id, reason, data: snapshot(guild) }, 2);
  return result?.id ?? null;
}

const summarize = (actions: Action[]) => actions.map((a) => `${a.ok ? "" : "échec : "}${a.type}${a.detail ? ` (${a.detail})` : ""}`).join(" · ").slice(0, 480);

async function run(client: Client, action: BotAction): Promise<{ ok: boolean; message: string }> {
  const guild = client.guilds.cache.get(action.guildId);
  if (!guild) return { ok: false, message: "Le bot n'est pas sur ce serveur Discord" };
  const config = getAntiraidConfig(guild.id);
  const incident = (kind: string, summary: string, actions: Action[], details: Record<string, unknown> = {}) =>
    config ? report(guild, config, { kind, actorId: null, actorName: "Panel", actorBot: false, summary, actions, details }) : Promise.resolve();

  switch (action.kind) {
    case "lockdown": {
      const minutes = Number(action.payload.minutes) || 30;
      const actions = await startLockdown(guild, minutes, action.payload.lockChannels === true, "verrouillage depuis le panel");
      await incident("lockdown", `Verrouillage manuel (${minutes} min)`, actions);
      return { ok: actions.every((a) => a.ok), message: summarize(actions) };
    }
    case "unlock": {
      const actions = await endLockdown(guild, "déverrouillage depuis le panel");
      return { ok: actions.every((a) => a.ok), message: summarize(actions) };
    }
    case "backup": {
      const id = await backupGuild(guild, "manuelle");
      return id ? { ok: true, message: `Sauvegarde #${id}` } : { ok: false, message: "Le panel n'a pas reçu la sauvegarde" };
    }
    case "audit": {
      const audit = await auditGuild(guild);
      return audit ? { ok: true, message: `Audit #${audit.id} : ${audit.score}/100` } : { ok: false, message: "Le panel n'a pas reçu l'audit" };
    }
    case "restore": {
      const got = await sitePost<{ data?: Backup }>("backup", { op: "get", guildId: guild.id, id: Number(action.payload.backupId) }, 2);
      if (!got?.data) return { ok: false, message: "Sauvegarde introuvable" };
      const { actions, remaps } = await restoreBackup(guild, got.data, `Fiverax : restauration de la sauvegarde #${action.payload.backupId}`);
      await incident("backup_restore", `Restauration de la sauvegarde #${action.payload.backupId}`, actions, { remaps });
      return { ok: true, message: summarize(actions) };
    }
  }
}

export function setupActions(client: Client, watched: (guildId: string) => boolean): void {
  let results: { id: number; ok: boolean; message: string }[] = [];
  let busy = false;

  const poll = async () => {
    if (busy) return;
    busy = true;
    try {
      const sent = results;
      results = [];
      const answer = await sitePost<{ actions?: BotAction[] }>("actions", { results: sent }, 1);
      if (!answer) {
        results = [...sent, ...results];
        return;
      }
      for (const action of answer.actions ?? []) {
        console.log(`[actions] ${action.kind} on ${action.guildId}`);
        const outcome = await run(client, action).catch((e) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
        results.push({ id: action.id, ...outcome });
      }
      if (results.length) setTimeout(() => void poll(), 500);
    } finally {
      busy = false;
    }
  };
  setInterval(() => void poll(), POLL_MS);
  void poll();

  const autoBackups = async () => {
    for (const guild of client.guilds.cache.values()) {
      const hours = getAntiraidConfig(guild.id)?.backupEveryHours ?? 0;
      if (!watched(guild.id) || hours <= 0) continue;
      const last = await sitePost<{ at?: string | null }>("backup", { op: "last", guildId: guild.id }, 1);
      if (!last) continue;
      if (last.at && Date.now() - new Date(last.at).getTime() < hours * 3600_000) continue;
      const id = await backupGuild(guild, "automatique");
      if (id) console.log(`[backup] ${guild.name}: #${id}`);
    }
    // Daily Discord security audit of every watched guild.
    for (const guild of client.guilds.cache.values()) {
      if (!watched(guild.id)) continue;
      const last = await sitePost<{ at?: string | null }>("discord-audit", { op: "last", guildId: guild.id }, 1);
      if (!last || (last.at && Date.now() - new Date(last.at).getTime() < AUDIT_EVERY_MS)) continue;
      const audit = await auditGuild(guild).catch(() => null);
      if (audit) console.log(`[audit] ${guild.name}: ${audit.score}/100`);
    }
  };
  setTimeout(() => void autoBackups(), 60_000);
  setInterval(() => void autoBackups(), BACKUP_CHECK_MS);
}
