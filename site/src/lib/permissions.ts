/** Permissions an owner can grant to each person / role from the "Accès & rôles" page. Client-safe (no DB). */
export const PERMISSIONS = [
  { key: "view_report", label: "Voir le bilan hebdo", group: "Consultation" },
  { key: "view_logs", label: "Voir les logs", group: "Consultation" },
  { key: "rank_up", label: "Up (monter d'un grade)", group: "Grades" },
  { key: "rank_down", label: "Down / Derank", group: "Grades" },
  { key: "rank_demote", label: "Demote (retirer du staff)", group: "Grades" },
  { key: "set_grade", label: "Choisir un grade précis", group: "Grades" },
  { key: "recruit", label: "Recruter du staff", group: "Grades" },
  { key: "warn_add", label: "Ajouter un avert", group: "Avertissements" },
  { key: "warn_remove", label: "Retirer un avert", group: "Avertissements" },
  { key: "comment", label: "Écrire des commentaires", group: "Suivi" },
  { key: "badges", label: "Gérer les pastilles", group: "Suivi" },
  { key: "sync", label: "Synchroniser Discord", group: "Suivi" },
  { key: "run_review", label: "Lancer le bilan IA", group: "Suivi" },
  { key: "reset_counters", label: "Reset des compteurs", group: "Suivi" },
  { key: "view_live", label: "Voir le serveur en direct et les joueurs", group: "Serveur FiveM" },
  { key: "player_message", label: "Message privé à un joueur", group: "Serveur FiveM" },
  { key: "player_kick", label: "Kick un joueur", group: "Serveur FiveM" },
  { key: "announce", label: "Annonce à tout le serveur", group: "Serveur FiveM" },
  { key: "resources", label: "Démarrer / arrêter les ressources", group: "Serveur FiveM" },
  { key: "console", label: "Console du serveur (commandes) et assistant IA", group: "Serveur FiveM" },
  { key: "player_manage", label: "Gérer les joueurs en jeu (argent, objets, job, réanimer, téléporter)", group: "Serveur FiveM" },
  { key: "server_files", label: "Laisser l'assistant IA lire et modifier les fichiers des ressources", group: "Serveur FiveM" },
  { key: "view_security", label: "Voir l'anticheat, les bans et l'anti-raid", group: "Sécurité" },
  { key: "ban", label: "Bannir / débannir des joueurs", group: "Sécurité" },
  { key: "screenshot", label: "Capturer l'écran d'un joueur", group: "Sécurité" },
  { key: "security_config", label: "Régler l'anticheat et l'anti-raid", group: "Sécurité" },
  { key: "studio", label: "Créer des UI, scripts et mappings avec l'IA", group: "Studio IA" },
  { key: "studio_deploy", label: "Déployer les créations sur le serveur FiveM", group: "Studio IA" },
  { key: "directory_edit", label: "Gérer la fiche du serveur dans l'annuaire public (et répondre aux avis)", group: "Réseau Fiverax" },
  { key: "library_publish", label: "Publier des créations dans la bibliothèque du réseau", group: "Réseau Fiverax" },
  { key: "shop_view", label: "Voir la boutique (ventes, paiements, catalogue, clients)", group: "Boutique Tebex" },
  { key: "shop_manage", label: "Gérer les paiements, le catalogue et les bans Tebex", group: "Boutique Tebex" },
  { key: "shop_promos", label: "Créer des codes promo et des cartes cadeaux", group: "Boutique Tebex" },
  { key: "store_edit", label: "Créer et publier la boutique en ligne (Store Creator)", group: "Boutique Tebex" }
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map((p) => p.key);

/** Granted to a newly added person/role until an owner changes it. */
export const DEFAULT_NEW_PERMISSIONS: Permission[] = ["view_report", "comment"];

export function parsePermissions(raw: string | null | undefined): Permission[] {
  if (!raw) return DEFAULT_NEW_PERMISSIONS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_NEW_PERMISSIONS;
    return parsed.filter((p): p is Permission => ALL_PERMISSIONS.includes(p as Permission));
  } catch {
    return DEFAULT_NEW_PERMISSIONS;
  }
}
