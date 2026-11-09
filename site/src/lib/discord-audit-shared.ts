import { z } from "zod";
import { gradeOf } from "./external-scan-shared";

/**
 * Discord security audit, pure (no DB): the bot sends how the guild is set up (bot/src/discord-audit.ts), this file
 * scores it out of 100 and explains each fix. Context the site knows (anti-raid, backups, alert channel) is added.
 * Client-safe: the Anti-raid page shows the result.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);
const bits = z.string().regex(/^\d{1,30}$/);

export const discordSnapshotSchema = z.object({
  memberCount: z.number().int().nonnegative(),
  verificationLevel: z.number().int().min(0).max(4),
  mfaLevel: z.number().int().min(0).max(1),
  explicitContentFilter: z.number().int().min(0).max(2),
  everyonePermissions: bits,
  bot: z.object({ permissions: bits, position: z.number().int() }),
  roles: z.array(z.object({ id: snowflake, name: z.string().max(100), permissions: bits, position: z.number().int(), members: z.number().int().nonnegative(), managed: z.boolean() })).max(250),
  humanAdmins: z.number().int().nonnegative(),
  bots: z.array(z.object({ id: snowflake, name: z.string().max(100), permissions: bits, verified: z.boolean() })).max(100),
  everyoneOverwrites: z.array(z.object({ channelId: snowflake, name: z.string().max(100), allow: bits })).max(200),
  webhooks: z.number().int().nonnegative().nullable(),
  invites: z.object({ total: z.number().int().nonnegative(), permanent: z.number().int().nonnegative() }).nullable()
});
export type DiscordSnapshot = z.infer<typeof discordSnapshotSchema>;

export type DiscordContext = { antiraidEnabled: boolean; observe: boolean; lastBackupAt: string | null; alertChannel: boolean; messageProtection: boolean };

// Discord permission bits.
// (BigInt() calls: the site targets ES2017, without bigint literals.)
const bit = (n: number) => BigInt(1) << BigInt(n);
const ZERO = BigInt(0);
const P = {
  kick: bit(1), ban: bit(2), admin: bit(3), channels: bit(4), guild: bit(5), auditLog: bit(7),
  mentionEveryone: bit(17), roles: bit(28), webhooks: bit(29), moderate: bit(40)
};
const DANGEROUS = P.admin | P.guild | P.roles | P.channels | P.ban | P.kick | P.webhooks;
const has = (perms: string, flag: bigint) => (BigInt(perms) & flag) !== ZERO;
const NAMES: [bigint, string][] = [[P.admin, "Administrateur"], [P.guild, "Gérer le serveur"], [P.roles, "Gérer les rôles"], [P.channels, "Gérer les salons"], [P.webhooks, "Gérer les webhooks"], [P.ban, "Bannir"], [P.kick, "Expulser"], [P.mentionEveryone, "Mentionner @everyone"]];
export const permissionNames = (perms: string) => NAMES.filter(([flag]) => has(perms, flag)).map(([, n]) => n);

type Severity = "critical" | "high" | "medium" | "info";
export type DiscordFinding = { rule: string; severity: Severity; title: string; detail: string; fix: string };
export type DiscordCheck = { key: string; label: string; status: "pass" | "fail" | "unknown" };
export type DiscordReport = { score: number; grade: string; findings: DiscordFinding[]; checks: DiscordCheck[]; counts: Record<Severity, number>; members: number };

const RULES: Record<string, Omit<DiscordFinding, "rule" | "detail">> = {
  bot_no_audit_log: { severity: "critical", title: "Le bot ne peut pas lire le journal d'audit", fix: "Donne la permission Administrateur au rôle du bot Fiverax : sans le journal d'audit, l'anti-raid ne voit pas qui supprime les salons et les rôles, il ne peut rien annuler." },
  bot_not_admin: { severity: "high", title: "Le bot n'est pas Administrateur", fix: "Paramètres du serveur > Rôles > rôle du bot Fiverax : coche Administrateur. Sans, il ne peut ni recréer un salon avec ses permissions, ni sanctionner l'auteur d'un nuke." },
  bot_role_low: { severity: "high", title: "Des rôles dangereux sont au-dessus du bot", fix: "Glisse le rôle du bot tout en haut de la liste des rôles : Discord interdit à un bot de toucher un membre dont le rôle est au-dessus du sien, donc ces personnes pourraient nuker sans être arrêtées." },
  everyone_dangerous: { severity: "critical", title: "@everyone a des permissions de modération", fix: "Paramètres du serveur > Rôles > @everyone : retire ces permissions. Aujourd'hui n'importe quel nouvel arrivant peut s'en servir (supprimer des salons, bannir, créer des webhooks)." },
  everyone_mention: { severity: "high", title: "@everyone peut mentionner @everyone", fix: "Retire « Mentionner @everyone, @here et tous les rôles » au rôle @everyone : c'est l'arme numéro un des raids et des comptes piratés (ping de tout le serveur avec un lien d'arnaque)." },
  channel_everyone: { severity: "high", title: "Salons où @everyone a des permissions dangereuses", fix: "Dans les permissions de ces salons, retire à @everyone : Gérer le salon, Gérer les permissions, Gérer les webhooks et Mentionner @everyone." },
  admin_bot_unverified: { severity: "high", title: "Bot non vérifié avec la permission Administrateur", fix: "Un bot non vérifié par Discord (petit bot, bot maison, bot « gratuit ») dont le token fuite peut nuker ton serveur en quelques secondes : retire-lui Administrateur et donne-lui seulement les permissions dont il a besoin, ou expulse-le." },
  admin_bot: { severity: "medium", title: "Bots tiers avec la permission Administrateur", fix: "Même vérifié, un bot Administrateur est une porte d'entrée si son compte est compromis : ne garde Administrateur que pour le bot Fiverax (qui en a besoin pour tout annuler) et réduis les autres." },
  many_admins: { severity: "medium", title: "Beaucoup de membres Administrateurs", fix: "Chaque compte Administrateur piraté peut nuker le serveur. Garde Administrateur pour 2 ou 3 personnes de confiance, donne au staff des permissions précises (expulser, rendre muet, gérer les messages)." },
  mfa_off: { severity: "medium", title: "Double authentification non exigée pour la modération", fix: "Paramètres du serveur > Sécurité (ou Modération) : active « Exiger l'A2F pour les actions de modération ». Un compte staff volé sans A2F ne pourra plus bannir ni supprimer de salons." },
  verification_low: { severity: "medium", title: "Niveau de vérification bas", fix: "Paramètres du serveur > Sécurité : passe au niveau Moyen (compte de plus de 5 minutes) ou Élevé (membre depuis plus de 10 minutes) : les bots de raid fraîchement créés ne peuvent plus écrire tout de suite." },
  content_filter_off: { severity: "info", title: "Filtre de contenu explicite désactivé", fix: "Paramètres du serveur > Sécurité : active le filtre des médias explicites pour tous les membres." },
  many_webhooks: { severity: "info", title: "Beaucoup de webhooks", fix: "Chaque webhook est une URL qui permet de poster dans un salon : supprime ceux qui ne servent plus (Paramètres du salon > Intégrations > Webhooks) et ne mets jamais leurs URL dans un script client FiveM." },
  permanent_invites: { severity: "info", title: "Beaucoup d'invitations permanentes", fix: "Les invitations sans expiration circulent partout (y compris chez les raiders) : garde un seul lien permanent officiel et supprime les autres." },
  antiraid_off: { severity: "high", title: "Anti-raid Fiverax désactivé", fix: "Active l'anti-raid (onglet Réglages) : sans lui, un nuke ou un raid de comptes n'est ni annulé ni sanctionné." },
  antiraid_observe: { severity: "medium", title: "Anti-raid en mode observation", fix: "Le bot signale les raids sans agir. Quand les incidents signalés te semblent justes, passe en mode Protection (onglet Réglages)." },
  no_backup: { severity: "medium", title: "Aucune sauvegarde récente du Discord", fix: "Lance une sauvegarde (bouton Sauvegarder) et laisse la sauvegarde automatique active : après un nuke, la restauration recrée rôles, salons et permissions." },
  no_alert_channel: { severity: "info", title: "Aucun salon d'alertes", fix: "Choisis un salon staff dans les réglages : chaque incident y est posté en direct." },
  message_protection_off: { severity: "info", title: "Protection des messages désactivée", fix: "Active-la dans les réglages : flood, @everyone, comptes piratés qui spamment tous les salons, liens d'arnaque faux Nitro / Steam." }
};

const PENALTY: Record<Severity, number> = { critical: 30, high: 12, medium: 5, info: 1 };
const DAY = 86_400_000;

/** Pure: the audit of a guild, scored out of 100 (any critical problem caps it at 35, any high one at 70). */
export function analyzeDiscord(snap: DiscordSnapshot, ctx: DiscordContext, now = new Date()): DiscordReport {
  const findings: DiscordFinding[] = [];
  const checks: DiscordCheck[] = [];
  const verdict = (key: string, label: string, failed: boolean | null, rule: string, detail: string) => {
    checks.push({ key, label, status: failed === null ? "unknown" : failed ? "fail" : "pass" });
    if (failed) findings.push({ rule, ...RULES[rule], detail });
  };
  const botAdmin = has(snap.bot.permissions, P.admin);

  // ---- the bot itself ----
  verdict("bot_audit_log", "Le bot lit le journal d'audit", !botAdmin && !has(snap.bot.permissions, P.auditLog), "bot_no_audit_log", "Permission « Voir les logs du serveur » absente.");
  verdict("bot_admin", "Le bot est Administrateur", !botAdmin, "bot_not_admin", "Le rôle du bot n'a pas la permission Administrateur.");
  const above = snap.roles.filter((r) => r.position > snap.bot.position && (BigInt(r.permissions) & DANGEROUS) !== ZERO && r.members > 0);
  verdict("bot_top", "Le rôle du bot est au-dessus des rôles dangereux", above.length > 0, "bot_role_low",
    `${above.slice(0, 6).map((r) => `@${r.name} (${r.members} membre${r.members > 1 ? "s" : ""})`).join(", ")}${above.length > 6 ? ` et ${above.length - 6} autre(s)` : ""}.`);

  // ---- @everyone ----
  const everyoneBad = permissionNames(String(BigInt(snap.everyonePermissions) & DANGEROUS));
  verdict("everyone_perms", "@everyone sans permission de modération", everyoneBad.length > 0, "everyone_dangerous", `@everyone peut : ${everyoneBad.join(", ")}.`);
  verdict("everyone_mention", "@everyone ne peut pas mentionner tout le monde", has(snap.everyonePermissions, P.mentionEveryone), "everyone_mention", "Permission « Mentionner @everyone » active pour tous.");
  verdict("channel_everyone", "Aucun salon n'ouvre de permission dangereuse à @everyone", snap.everyoneOverwrites.length > 0, "channel_everyone",
    snap.everyoneOverwrites.slice(0, 6).map((o) => `#${o.name} (${permissionNames(o.allow).join(", ")})`).join(" · ") + (snap.everyoneOverwrites.length > 6 ? ` et ${snap.everyoneOverwrites.length - 6} autre(s)` : ""));

  // ---- who holds the keys ----
  const adminBots = snap.bots.filter((b) => has(b.permissions, P.admin));
  const unverified = adminBots.filter((b) => !b.verified);
  verdict("bots_unverified", "Aucun bot non vérifié Administrateur", unverified.length > 0, "admin_bot_unverified", unverified.slice(0, 8).map((b) => b.name).join(", ") + ".");
  verdict("bots_admin", "Aucun autre bot Administrateur", adminBots.length - unverified.length > 0, "admin_bot", adminBots.filter((b) => b.verified).slice(0, 8).map((b) => b.name).join(", ") + ".");
  verdict("admins", "Peu de membres Administrateurs (5 au plus)", snap.humanAdmins > 5, "many_admins", `${snap.humanAdmins} membres (hors propriétaire et bots) ont Administrateur.`);

  // ---- guild settings ----
  verdict("mfa", "A2F exigée pour la modération", snap.mfaLevel === 0, "mfa_off", "Un modérateur sans double authentification peut bannir et supprimer des salons.");
  verdict("verification", "Niveau de vérification Moyen ou plus", snap.verificationLevel < 2, "verification_low", snap.verificationLevel === 0 ? "Aucune vérification." : "Vérification faible (e-mail seulement).");
  verdict("content_filter", "Filtre de contenu explicite actif", snap.explicitContentFilter === 0, "content_filter_off", "");
  verdict("webhooks", "Webhooks sous contrôle (15 au plus)", snap.webhooks === null ? null : snap.webhooks > 15, "many_webhooks", `${snap.webhooks} webhooks.`);
  verdict("invites", "Peu d'invitations permanentes (5 au plus)", snap.invites === null ? null : snap.invites.permanent > 5, "permanent_invites", `${snap.invites?.permanent} invitations sans expiration ni limite sur ${snap.invites?.total}.`);

  // ---- Fiverax ----
  verdict("antiraid", "Anti-raid Fiverax actif", !ctx.antiraidEnabled, "antiraid_off", "");
  if (ctx.antiraidEnabled) verdict("antiraid_mode", "Anti-raid en mode Protection", ctx.observe, "antiraid_observe", "Les raids sont signalés, rien n'est annulé.");
  const backupAge = ctx.lastBackupAt ? now.getTime() - new Date(ctx.lastBackupAt).getTime() : Infinity;
  verdict("backup", "Sauvegarde de moins de 7 jours", backupAge > 7 * DAY, "no_backup", ctx.lastBackupAt ? "Dernière sauvegarde il y a plus de 7 jours." : "Aucune sauvegarde.");
  verdict("alert_channel", "Salon d'alertes choisi", !ctx.alertChannel, "no_alert_channel", "");
  verdict("messages", "Protection des messages active", !ctx.messageProtection, "message_protection_off", "");

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, info: 0 };
  let penalty = 0;
  for (const f of findings) {
    counts[f.severity]++;
    penalty += PENALTY[f.severity];
  }
  let score = Math.max(0, Math.round(100 - penalty));
  if (counts.critical) score = Math.min(score, 35);
  else if (counts.high) score = Math.min(score, 70);
  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, info: 3 };
  return { score, grade: gradeOf(score), findings: findings.sort((a, b) => order[a.severity] - order[b.severity]), checks, counts, members: snap.memberCount };
}
