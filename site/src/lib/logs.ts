import { db } from "./db";
import { categoryLabel, NETWORK_MODES } from "./network-shared";
import { PERMISSIONS } from "./permissions";

export type LogTone = "up" | "down" | "danger" | "warn" | "info" | "neutral";

export const LOG_GROUPS: Record<string, { label: string; actions: string[] }> = {
  grades: { label: "Grades", actions: ["recruit", "rank_up", "rank_down", "rank_demote", "grade_change"] },
  warnings: { label: "Avertissements", actions: ["warn_add", "warn_remove"] },
  follow: { label: "Commentaires & pastilles", actions: ["note_create", "badge_create", "badge_resolve"] },
  access: { label: "Accès & rôles", actions: ["access_add", "access_remove", "access_permissions", "grade_role_add", "grade_role_remove", "warn_role_set"] },
  sync: { label: "Synchro, IA & reset", actions: ["staff_sync", "review_generate", "counters_reset"] },
  fivem: { label: "Serveur FiveM", actions: ["player_kick", "player_message", "announce", "resource", "console_command", "player_screenshot", "server_files", "player_game"] },
  security: { label: "Sécurité", actions: ["player_ban", "player_unban", "anticheat_config", "antiraid_config", "antiraid_restore", "player_screen", "player_freeze", "discord_lockdown", "discord_unlock", "discord_backup", "discord_restore"] },
  audit: { label: "Scanner", actions: ["audit_run", "audit_settings"] },
  studio: { label: "Studio IA", actions: ["studio_create", "studio_delete", "studio_deploy"] },
  network: { label: "Réseau Fiverax", actions: ["network_join", "network_settings", "network_leave", "ban_sharing", "library_publish", "library_unpublish", "library_install", "library_update", "library_report"] },
  shop: { label: "Boutique", actions: ["shop_config", "shop_webhook_rotate", "shop_payment_note", "shop_payment_status", "shop_manual_payment", "shop_package", "shop_checkout", "shop_coupon_create", "shop_coupon_delete", "shop_giftcard_create", "shop_giftcard_void", "shop_giftcard_topup", "shop_ban"] },
  directory: { label: "Annuaire", actions: ["directory_listing", "directory_publish", "directory_unpublish", "directory_reply", "directory_featured", "directory_unfeatured"] },
  store: { label: "Store Creator", actions: ["store_publish", "store_unpublish", "store_slug", "store_restore", "store_ai"] },
  server: { label: "Serveur", actions: ["server_create","server_update", "owner_add", "owner_remove", "fivem_token_rotate", "server_suspended", "server_unsuspended"] }
};

const ACTION_LABELS: Record<string, { label: string; tone: LogTone }> = {
  recruit: { label: "Recrutement", tone: "up" },
  counters_reset: { label: "Reset compteurs", tone: "danger" },
  rank_up: { label: "Up", tone: "up" },
  rank_down: { label: "Down", tone: "down" },
  rank_demote: { label: "Demote", tone: "danger" },
  grade_change: { label: "Grade modifié", tone: "info" },
  warn_add: { label: "Avert ajouté", tone: "warn" },
  warn_remove: { label: "Avert retiré", tone: "up" },
  note_create: { label: "Commentaire", tone: "neutral" },
  badge_create: { label: "Pastille", tone: "neutral" },
  badge_resolve: { label: "Pastille résolue", tone: "neutral" },
  access_add: { label: "Accès ajouté", tone: "info" },
  access_remove: { label: "Accès retiré", tone: "danger" },
  access_permissions: { label: "Permissions", tone: "info" },
  grade_role_add: { label: "Rôle de grade +", tone: "info" },
  grade_role_remove: { label: "Rôle de grade −", tone: "info" },
  warn_role_set: { label: "Rôle d'avert", tone: "info" },
  staff_sync: { label: "Synchro Discord", tone: "neutral" },
  review_generate: { label: "Bilan IA", tone: "info" },
  server_create: { label: "Serveur créé", tone: "up" },
  server_update: { label: "Serveur modifié", tone: "info" },
  owner_add: { label: "Propriétaire +", tone: "info" },
  owner_remove: { label: "Propriétaire −", tone: "danger" },
  fivem_token_rotate: { label: "Token FiveM", tone: "warn" },
  server_suspended: { label: "Suspendu par Fiverax", tone: "danger" },
  server_unsuspended: { label: "Rétabli par Fiverax", tone: "up" },
  player_kick: { label: "Kick", tone: "danger" },
  player_message: { label: "Message joueur", tone: "neutral" },
  announce: { label: "Annonce", tone: "info" },
  resource: { label: "Ressource", tone: "warn" },
  console_command: { label: "Console", tone: "warn" },
  server_files: { label: "Fichiers (assistant IA)", tone: "warn" },
  player_game: { label: "Action en jeu", tone: "warn" },
  player_screenshot: { label: "Capture d'écran", tone: "neutral" },
  player_ban: { label: "Ban", tone: "danger" },
  player_unban: { label: "Déban", tone: "up" },
  anticheat_config: { label: "Réglages anticheat", tone: "warn" },
  antiraid_config: { label: "Réglages anti-raid", tone: "warn" },
  antiraid_restore: { label: "Rôles rendus", tone: "up" },
  player_screen: { label: "Écran en direct", tone: "warn" },
  player_freeze: { label: "Gel du joueur", tone: "warn" },
  discord_lockdown: { label: "Discord verrouillé", tone: "danger" },
  discord_unlock: { label: "Discord déverrouillé", tone: "up" },
  discord_backup: { label: "Sauvegarde Discord", tone: "info" },
  discord_restore: { label: "Restauration Discord", tone: "danger" },
  audit_run: { label: "Scan du serveur", tone: "info" },
  audit_settings: { label: "Réglages du scanner", tone: "warn" },
  studio_create: { label: "Studio : création", tone: "info" },
  studio_delete: { label: "Studio : suppression", tone: "danger" },
  studio_deploy: { label: "Studio : déploiement", tone: "warn" },
  network_join: { label: "Réseau : adhésion", tone: "up" },
  network_settings: { label: "Réseau : réglages", tone: "warn" },
  network_leave: { label: "Réseau : départ", tone: "danger" },
  ban_sharing: { label: "Partage d'un ban", tone: "info" },
  library_publish: { label: "Bibliothèque : publication", tone: "up" },
  library_unpublish: { label: "Bibliothèque : retrait", tone: "danger" },
  library_install: { label: "Bibliothèque : installation", tone: "info" },
  library_update: { label: "Bibliothèque : mise à jour", tone: "info" },
  library_report: { label: "Bibliothèque : signalement", tone: "warn" },
  shop_config: { label: "Réglages boutique", tone: "warn" },
  shop_webhook_rotate: { label: "Webhook Tebex", tone: "warn" },
  shop_payment_note: { label: "Note de paiement", tone: "neutral" },
  shop_payment_status: { label: "Statut de paiement", tone: "warn" },
  shop_manual_payment: { label: "Paiement manuel", tone: "info" },
  shop_package: { label: "Package modifié", tone: "info" },
  shop_checkout: { label: "Lien d'achat", tone: "neutral" },
  shop_coupon_create: { label: "Code promo +", tone: "info" },
  shop_coupon_delete: { label: "Code promo −", tone: "danger" },
  shop_giftcard_create: { label: "Carte cadeau +", tone: "info" },
  shop_giftcard_void: { label: "Carte cadeau annulée", tone: "danger" },
  shop_giftcard_topup: { label: "Carte cadeau rechargée", tone: "info" },
  shop_ban: { label: "Ban boutique", tone: "danger" },
  store_publish: { label: "Boutique publiée", tone: "up" },
  store_unpublish: { label: "Boutique hors ligne", tone: "danger" },
  store_slug: { label: "Adresse boutique", tone: "warn" },
  store_restore: { label: "Version restaurée", tone: "info" },
  store_ai: { label: "Store Creator : IA", tone: "info" },
  directory_listing: { label: "Annuaire : fiche modifiée", tone: "info" },
  directory_publish: { label: "Annuaire : fiche publiée", tone: "up" },
  directory_unpublish: { label: "Annuaire : fiche retirée", tone: "warn" },
  directory_reply: { label: "Annuaire : réponse à un avis", tone: "info" },
  directory_featured: { label: "Annuaire : mise en avant", tone: "up" },
  directory_unfeatured: { label: "Annuaire : mise en avant retirée", tone: "warn" }
};

const PAYMENT_STATUS: Record<string, string> = { complete: "payé", refund: "remboursé", chargeback: "chargeback" };

const STUDIO_KINDS: Record<string, string> = { ui: "UI", script: "Script", map: "Mapping" };
const NETWORK_MODE_LABELS: Record<string, string> = Object.fromEntries(NETWORK_MODES.map((m) => [m.key, m.label.toLowerCase()]));

const RESOURCE_VERBS: Record<string, string> = { start: "Démarrage", stop: "Arrêt", restart: "Redémarrage", refresh: "Rechargement de la liste des ressources" };

export function actionMeta(action: string): { label: string; tone: LogTone; failed: boolean } {
  const failed = action.endsWith("_failed");
  const base = failed ? action.slice(0, -"_failed".length) : action;
  const meta = ACTION_LABELS[base] ?? { label: base, tone: "neutral" as LogTone };
  return failed ? { label: `Échec · ${meta.label}`, tone: "danger", failed } : { ...meta, failed };
}

const permissionLabel = (key: string) => PERMISSIONS.find((p) => p.key === key)?.label ?? key;

function describe(action: string, d: Record<string, unknown>): string {
  const reason = d.reason ? ` — « ${String(d.reason)} »` : "";
  switch (action.replace(/_failed$/, "")) {
    case "rank_up":
    case "rank_down":
    case "rank_demote":
    case "grade_change":
      if (action.endsWith("_failed")) return d.discordStatus === 403 ? "Discord a refusé (rôle du bot trop bas)" : `Discord a refusé (code ${d.discordStatus})`;
      return `${d.from ?? "?"} → ${d.to ?? "?"}${reason}`;
    case "warn_add":
    case "warn_remove":
      if (action.endsWith("_failed")) return d.discordStatus === 403 ? "Discord a refusé (rôle du bot trop bas)" : `Discord a refusé (code ${d.discordStatus})`;
      return `Avert ${d.level ?? "?"}${reason}`;
    case "note_create":
      return d.body ? `« ${String(d.body).slice(0, 200)} »` : "";
    case "badge_create":
      return `${d.color ?? ""}${reason}`;
    case "access_add":
    case "access_remove":
      return `${d.type === "role" ? "Rôle" : "Personne"} ${d.label ?? d.discordId ?? ""}`;
    case "access_permissions":
      return `${d.label ?? d.discordId ?? ""} : ${Array.isArray(d.permissions) && d.permissions.length ? (d.permissions as string[]).map(permissionLabel).join(", ") : "aucune"}`;
    case "recruit":
      if (action.endsWith("_failed")) return d.discordStatus === 403 ? "Discord a refusé (rôle du bot trop bas)" : `Discord a refusé (code ${d.discordStatus})`;
      return `Nouveau staff : ${d.to ?? "?"}${reason}`;
    case "counters_reset":
      return "Temps vocal et temps de jeu remis à zéro (historique conservé)";
    case "review_generate":
      return `Semaine du ${d.week ?? "?"} : ${d.generated ?? 0} résumé(s), ${d.skipped ?? 0} déjà fait(s), ${d.failed ?? 0} échec(s)`;
    case "server_create":
    case "server_update":
      return Object.entries(d).map(([k, v]) => `${k} : ${v ?? "—"}`).join(" · ");
    case "owner_add":
    case "owner_remove":
      return String(d.label ?? d.discordId ?? "");
    case "fivem_token_rotate":
      return "Nouveau token de l'agent FiveM (l'ancien ne marche plus)";
    case "server_suspended":
      return `Panel, agent FiveM, bot et pages publiques arrêtés par l'administration Fiverax${reason}`;
    case "server_unsuspended":
      return "Tout fonctionne de nouveau";
    case "player_kick":
      return `${d.player ?? `#${d.target}`}${reason}`;
    case "player_message":
      return `${d.player ?? `#${d.target}`} : « ${String(d.message ?? "").slice(0, 200)} »`;
    case "announce":
      return `« ${String(d.message ?? "").slice(0, 200)} »`;
    case "resource":
      return `${RESOURCE_VERBS[String(d.action)] ?? d.action}${d.name ? ` de ${d.name}` : ""}`;
    case "console_command":
      return `> ${String(d.command ?? "").slice(0, 200)}`;
    case "player_game": {
      const who = d.player ?? `#${d.target}`;
      const acc = ({ cash: "liquide", bank: "banque", black_money: "argent sale" } as Record<string, string>)[String(d.account)] ?? d.account;
      switch (d.op) {
        case "give_money": return `+${Number(d.amount).toLocaleString("fr-FR")} $ (${acc}) à ${who}`;
        case "remove_money": return `−${Number(d.amount).toLocaleString("fr-FR")} $ (${acc}) à ${who}`;
        case "give_item": return `+${d.count}x ${d.item} à ${who}`;
        case "remove_item": return `−${d.count}x ${d.item} à ${who}`;
        case "set_job": return `${who} → job ${d.job} (grade ${d.grade})`;
        case "revive": return `Réanimation de ${who}`;
        case "heal": return `Soin de ${who}`;
        case "teleport": return `Téléportation de ${who}${d.to !== undefined ? ` vers #${d.to}` : ` (${Math.round(Number(d.x))}, ${Math.round(Number(d.y))}, ${Math.round(Number(d.z))})`}`;
        default: return `Infos de ${who}`;
      }
    }
    case "server_files": {
      const verb = d.op === "write" ? "Modification" : d.op === "list" ? "Liste des fichiers" : "Lecture";
      const paths = Array.isArray(d.paths) ? ` : ${(d.paths as string[]).slice(0, 5).join(", ")}${d.paths.length > 5 ? "…" : ""}` : "";
      return `${verb} de ${d.resource}${paths}${d.op === "write" && d.restart ? " · redémarrage" : ""}`;
    }
    case "player_screenshot":
      return `${d.player ?? `#${d.target}`}`;
    case "player_ban":
      return `${d.player ?? "?"}${reason}${d.expiresAt ? ` · jusqu'au ${new Date(String(d.expiresAt)).toLocaleString("fr-FR", { timeZone: process.env.APP_TIMEZONE || "Europe/Paris" })}` : " · définitif"}${d.source && d.source !== "manual" ? ` (${d.source === "ai" ? "IA" : "anticheat"})` : ""}`;
    case "player_unban":
      return `${d.player ?? "?"}`;
    case "anticheat_config":
      return "Réglages de l'anticheat modifiés";
    case "antiraid_config":
      return "Réglages de l'anti-raid modifiés";
    case "player_screen":
      return `${d.player ?? `#${d.target}`}`;
    case "player_freeze":
      return `${d.on ? "Gel" : "Dégel"} de ${d.player ?? `#${d.target}`}`;
    case "discord_lockdown":
      return `${d.minutes ?? "?"} min${d.lockChannels ? ", salons fermés" : ""}`;
    case "discord_unlock":
    case "discord_backup":
      return "";
    case "discord_restore":
      return `Sauvegarde #${d.backupId ?? "?"}`;
    case "antiraid_restore":
      return `${d.roles ?? 0} rôle(s) rendu(s) après une sanction de l'anti-raid`;
    case "audit_run":
      return "Scan lancé depuis le panel";
    case "audit_settings":
      return `Scan continu ${d.continuous ? "activé" : "désactivé"}, alertes ${d.alert ? "activées" : "désactivées"}`;
    case "studio_create":
    case "studio_delete":
      return `${d.kind ? `${STUDIO_KINDS[String(d.kind)] ?? d.kind} ` : ""}« ${d.name ?? "?"} » (${d.resource ?? "?"})`;
    case "studio_deploy":
      return `${d.resource ?? "?"} · ${d.files ?? 0} fichier(s) envoyé(s) au serveur`;
    case "shop_config": {
      const parts = [d.secret && `clé secrète ${d.secret === "removed" ? "retirée" : "changée"}`, d.webhookSecret && `secret du webhook ${d.webhookSecret === "removed" ? "retiré" : "changé"}`,
        d.publicToken && `token public ${d.publicToken === "removed" ? "retiré" : "renseigné"}`, d.alerts !== undefined && `alertes Discord ${d.alerts ? "activées" : "désactivées"}`];
      return parts.filter(Boolean).join(" · ") || "Réglages enregistrés";
    }
    case "shop_webhook_rotate":
      return "Nouvelle adresse de webhook (l'ancienne ne marche plus)";
    case "shop_payment_note":
      return `${d.txn ?? "?"} : « ${String(d.note ?? "").slice(0, 200)} »`;
    case "shop_payment_status":
      return `${d.txn ?? "?"} marqué ${PAYMENT_STATUS[String(d.status)] ?? d.status}${d.player ? ` (${d.player})` : ""}`;
    case "shop_manual_payment":
      return `${d.player ?? "?"} · package(s) ${Array.isArray(d.packages) ? d.packages.join(", ") : "?"}${d.note ? ` — « ${d.note} »` : ""}`;
    case "shop_package":
      return `#${d.id ?? "?"} « ${d.name ?? "?"} » · ${d.price ?? "?"}${d.disabled ? " · désactivé" : ""}`;
    case "shop_checkout":
      return `Package #${d.packageId ?? "?"} pour ${d.player ?? "?"}`;
    case "shop_coupon_create":
      return `${d.code ?? "?"} · −${d.discount ?? "?"}${d.limit ? ` · ${d.limit} utilisation(s)` : ""}${d.expireDate ? ` · jusqu'au ${d.expireDate}` : ""}`;
    case "shop_coupon_delete":
      return String(d.code ?? "");
    case "shop_giftcard_create":
      return `${d.amount ?? "?"}${d.note ? ` — « ${d.note} »` : ""}`;
    case "shop_giftcard_void":
      return `Carte #${d.card ?? "?"}`;
    case "shop_giftcard_topup":
      return `Carte #${d.card ?? "?"} · +${d.amount ?? "?"}`;
    case "shop_ban":
      return `${d.player ?? "?"}${reason}`;
    case "store_publish":
      return `/store/${d.slug ?? "?"} · ${d.blocks ?? 0} bloc(s)`;
    case "store_unpublish":
      return `/store/${d.slug ?? "?"} n'est plus accessible`;
    case "store_slug":
      return `/store/${d.from ?? "?"} → /store/${d.to ?? "?"}`;
    case "store_restore":
      return `Version #${d.version ?? "?"} remise dans le brouillon`;
    case "store_ai":
      return `« ${String(d.prompt ?? "").slice(0, 200)} »`;
    case "directory_listing":
    case "directory_publish":
    case "directory_unpublish":
      return `/annuaire/${d.slug ?? "?"}`;
    case "directory_reply":
      return d.removed ? `Réponse retirée (avis #${d.reviewId})` : `Avis #${d.reviewId}`;
    case "directory_featured":
      return `${d.days} jour(s), jusqu'au ${new Date(String(d.endsAt)).toLocaleDateString("fr-FR")}`;
    case "directory_unfeatured":
      return `Créneau #${d.id}`;
    case "network_join":
    case "network_settings":
      return `Mode ${NETWORK_MODE_LABELS[String(d.mode)] ?? d.mode ?? "?"}${d.mode === "block" ? ` dès ${d.minServers ?? "?"} serveur(s)` : ""}`;
    case "network_leave":
      return "Le serveur a quitté le réseau : ses bans ne sont plus partagés";
    case "ban_sharing":
      return `${d.player ?? "?"} · ${d.shared ? "partagé avec le réseau" : "gardé sur ce serveur"} · ${categoryLabel(String(d.category ?? "other"))}`;
    case "library_publish":
      return `« ${d.title ?? "?"} » v${d.version ?? 1}`;
    case "library_unpublish":
    case "library_report":
      return `« ${d.title ?? "?"} »${reason}`;
    case "library_install":
      return `« ${d.title ?? "?"} » v${d.version ?? "?"} de ${d.from ?? "?"} → ${d.resource ?? "?"}`;
    case "library_update":
      return `« ${d.title ?? "?"} » passée en v${d.version ?? "?"}`;
    case "staff_sync":
      return `${d.total ?? 0} membres · +${d.inserted ?? 0} / ~${d.updated ?? 0} / −${d.markedLeft ?? 0}`;
    default:
      return Object.keys(d).length ? JSON.stringify(d) : "";
  }
}

export type LogRow = {
  id: number;
  createdAt: string;
  actorId: string;
  actorName: string;
  action: string;
  label: string;
  tone: LogTone;
  targetId: string | null;
  targetName: string | null;
  details: string;
};

export async function listLogs(serverId: string, opts: { group?: string; q?: string; limit?: number; offset?: number }): Promise<{ rows: LogRow[]; total: number }> {
  const where: string[] = ["a.server_id = @server"];
  const params: Record<string, unknown> = { server: serverId };
  const group = opts.group ? LOG_GROUPS[opts.group] : undefined;
  if (opts.group === "failed") where.push("a.action LIKE '%\\_failed' ESCAPE '\\'");
  else if (group) {
    const names = group.actions.flatMap((n) => [n, `${n}_failed`]);
    where.push(`a.action IN (${names.map((_, i) => `@g${i}`).join(",")})`);
    names.forEach((n, i) => (params[`g${i}`] = n));
  }
  if (opts.q?.trim()) {
    where.push(
      `(LOWER(COALESCE(a.actor_name, sa.username, '')) LIKE @q OR LOWER(COALESCE(st.username, '')) LIKE @q
        OR a.actor_discord_id LIKE @q OR a.target_discord_id LIKE @q)`
    );
    params.q = `%${opts.q.trim().toLowerCase()}%`;
  }
  const clause = `WHERE ${where.join(" AND ")}`;
  const from = `FROM audit_log a
    LEFT JOIN staff_members sa ON sa.server_id = a.server_id AND sa.discord_id = a.actor_discord_id
    LEFT JOIN staff_members st ON st.server_id = a.server_id AND st.discord_id = a.target_discord_id ${clause}`;

  const [countRow, rows] = await Promise.all([
    db.get<{ n: number }>(`SELECT COUNT(*) AS n ${from}`, params as never),
    db.all<{
      id: number; created_at: string; actor_discord_id: string; action: string; target_discord_id: string | null;
      details: string; actor_name: string; target_name: string | null;
    }>(
      `SELECT a.id, a.created_at, a.actor_discord_id, a.action, a.target_discord_id, a.details,
              COALESCE(a.actor_name, sa.username, a.actor_discord_id) AS actor_name, st.username AS target_name
       ${from} ORDER BY a.id DESC LIMIT @limit OFFSET @offset`,
      { ...params, limit: opts.limit ?? 50, offset: opts.offset ?? 0 } as never
    )
  ]);
  const total = countRow?.n ?? 0;

  return {
    total,
    rows: rows.map((r) => {
      let details: Record<string, unknown> = {};
      try { details = JSON.parse(r.details) as Record<string, unknown>; } catch { /* keep empty */ }
      const meta = actionMeta(r.action);
      return {
        id: r.id,
        createdAt: r.created_at,
        actorId: r.actor_discord_id,
        actorName: r.actor_name,
        action: r.action,
        label: meta.label,
        tone: meta.tone,
        targetId: r.target_discord_id,
        targetName: r.target_name,
        details: describe(r.action, details)
      };
    })
  };
}
