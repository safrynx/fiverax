"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { tebexErrorMessage } from "@/lib/tebex-shared";

type AskInput = { label: string; placeholder?: string; required?: boolean; multiline?: boolean; initial?: string };
type AskSelect = { label: string; options: { value: string; label: string }[]; initial?: string };
type AskCheck = { label: string; hint?: string; initial?: boolean };
export type AskOptions = { title: string; message?: string; confirmLabel?: string; danger?: boolean; input?: AskInput; select?: AskSelect; check?: AskCheck };
/** What the dialog gives back: the typed text, and the chosen option / the box when the dialog had them. */
export type AskResult = { value: string; choice?: string; checked?: boolean };
type ToastKind = "ok" | "error" | "info";

type UIContext = {
  /** In-page replacement for confirm()/prompt(): resolves with the typed value, or null when cancelled. */
  ask: (options: AskOptions) => Promise<AskResult | null>;
  toast: (message: string, kind?: ToastKind) => void;
};

const Ctx = createContext<UIContext | null>(null);

export function useUI(): UIContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUI must be used inside <UIProvider>");
  return ctx;
}

type Pending = { options: AskOptions; resolve: (value: AskResult | null) => void };

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: ToastKind }[]>([]);
  const [value, setValue] = useState("");
  const [choice, setChoice] = useState("");
  const [checked, setChecked] = useState(false);
  const nextId = useRef(1);

  const ask = useCallback<UIContext["ask"]>(
    (options) =>
      new Promise((resolve) => {
        setValue(options.input?.initial ?? "");
        setChoice(options.select?.initial ?? options.select?.options[0]?.value ?? "");
        setChecked(options.check?.initial ?? false);
        setPending({ options, resolve });
      }),
    []
  );

  const toast = useCallback<UIContext["toast"]>((message, kind = "info") => {
    const id = nextId.current++;
    setToasts((list) => [...list, { id, message, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === "error" ? 7000 : 3800);
  }, []);

  const close = useCallback(
    (result: AskResult | null) => {
      pending?.resolve(result);
      setPending(null);
    },
    [pending]
  );

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, close]);

  const input = pending?.options.input;

  return (
    <Ctx.Provider value={{ ask, toast }}>
      {children}
      {pending && (
        <div className="veil" onMouseDown={(e) => e.target === e.currentTarget && close(null)}>
          <form
            className="dialog"
            onSubmit={(e) => {
              e.preventDefault();
              close({
                value: value.trim(),
                ...(pending.options.select ? { choice } : {}),
                ...(pending.options.check ? { checked } : {})
              });
            }}
          >
            <h3>{pending.options.title}</h3>
            {pending.options.message && <p>{pending.options.message}</p>}
            {input && (
              <>
                <label htmlFor="ui-input">{input.label}</label>
                {input.multiline ? (
                  <textarea id="ui-input" className="field" autoFocus required={input.required} placeholder={input.placeholder} value={value} onChange={(e) => setValue(e.target.value)} rows={3} />
                ) : (
                  <input id="ui-input" className="field" autoFocus required={input.required} placeholder={input.placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
                )}
              </>
            )}
            {pending.options.select && (
              <>
                <label htmlFor="ui-select">{pending.options.select.label}</label>
                <select id="ui-select" className="field" value={choice} onChange={(e) => setChoice(e.target.value)}>
                  {pending.options.select.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </>
            )}
            {pending.options.check && (
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 14, cursor: "pointer" }}>
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 3 }} />
                <span>{pending.options.check.label}{pending.options.check.hint && <small className="muted" style={{ display: "block" }}>{pending.options.check.hint}</small>}</span>
              </label>
            )}
            <div className="actions">
              <button type="button" className="btn" onClick={() => close(null)}>Annuler</button>
              <button type="submit" autoFocus={!input} className={`btn ${pending.options.danger ? "danger" : "primary"}`}>
                {pending.options.confirmLabel ?? "Confirmer"}
              </button>
            </div>
          </form>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className="toast" data-kind={t.kind}>{t.message}</div>)}
      </div>
    </Ctx.Provider>
  );
}

/** URLs of the server being viewed (pages under /s/[serverId]): `api("admin?kind=note")`, `page("/staff")`. */
export function useServerPaths() {
  const { serverId } = useParams<{ serverId: string }>();
  // Stable between renders, so it can sit in effect / callback dependencies.
  return useMemo(() => ({
    serverId,
    api: (path: string) => `/api/s/${serverId}/${path}`,
    page: (path = "") => `/s/${serverId}${path}`
  }), [serverId]);
}

/** Shared helper: turn an API error response into a readable French message. */
export function describeApiError(data: { error?: string; discordStatus?: number; permission?: string; message?: string }, status: number): string {
  switch (data.error) {
    case "discord_role_update_failed":
      return data.discordStatus === 403
        ? "Discord refuse : place le rôle du bot AU-DESSUS des rôles de grade (Paramètres du serveur > Rôles)."
        : `Discord a refusé le changement de rôle (code ${data.discordStatus}).`;
    case "forbidden_grade":
    case "forbidden_warning":
      return "Hiérarchie : tu ne peux pas agir sur ce membre.";
    case "forbidden_permission":
      return "Tu n'as pas la permission pour cette action.";
    case "already_highest": return "Déjà au grade le plus haut.";
    case "already_lowest": return "Déjà au grade le plus bas (utilise Demote pour le retirer du staff).";
    case "max_warnings_reached": return "Maximum d'avertissements atteint (3).";
    case "unknown_warning": return "Aucun avertissement à retirer.";
    case "no_grade_roles_configured": return "Aucun rôle de grade configuré (page Accès & rôles).";
    case "unauthenticated": return "Session expirée : reconnecte-toi.";
    case "already_exists": return "Déjà dans la liste.";
    case "bot_unavailable": return "Bot Discord injoignable (token incorrect, ou bot absent de ce serveur Discord).";
    case "no_guild": return "Aucun serveur Discord lié : renseigne son ID dans Configuration.";
    case "guild_taken": return "Ce serveur Discord est déjà lié à un autre serveur du panel.";
    case "invalid_timezone": return "Fuseau horaire inconnu (exemple : Europe/Paris).";
    case "last_owner": return "Impossible : le serveur doit garder au moins un propriétaire.";
    case "unknown_server": return "Serveur introuvable.";
    case "forbidden": return "Accès refusé.";
    case "guild_required": return "Choisis un serveur Discord.";
    case "guild_not_managed": return "Il te faut la permission « Gérer le serveur » sur ce serveur Discord (reconnecte-toi si tu viens de l'obtenir).";
    case "too_many_servers": return "Tu as atteint le nombre maximum de serveurs.";
    case "confirm_mismatch": return "Le nom tapé ne correspond pas : rien n'a été supprimé.";
    case "agent_offline": return "Le serveur FiveM ne répond pas (agent arrêté ou serveur éteint).";
    case "player_offline": return "Ce joueur n'est plus connecté.";
    case "unknown_player": return "Joueur introuvable.";
    case "unknown_ban": return "Ce ban n'existe plus ou est déjà levé.";
    case "unknown_incident": return "Incident introuvable.";
    case "nothing_to_restore": return "Rien à rendre : les rôles ont déjà été rendus.";
    case "unknown_screenshot": return "Capture introuvable (supprimée après 30 jours).";
    case "validation": return "Valeurs invalides : vérifie le formulaire.";
    case "audit_running": return "Un scan est déjà en cours.";
    case "unknown_scan": return "Scan introuvable (les 30 derniers sont gardés).";
    case "unknown_finding": return "Problème introuvable dans ce rapport.";
    case "resource_taken": return "Une création porte déjà ce nom de ressource sur ce serveur : choisis-en un autre.";
    case "slug_taken": return "Cette adresse est déjà prise par un autre serveur : choisis-en une autre.";
    case "invalid_slug": return "Adresse invalide : 3 à 40 caractères, minuscules, chiffres et tirets.";
    case "invalid_name": return "Nom invalide (2 à 60 caractères).";
    case "invalid_connect": return "Adresse de connexion invalide : cfx.re/join/xxxxxx ou ip:port.";
    case "invalid_discord": return "Invitation Discord invalide : discord.gg/xxxx.";
    case "invalid_logoUrl":
    case "invalid_bannerUrl":
    case "invalid_gallery":
    case "invalid_website": return "Lien invalide : il doit commencer par https://.";
    case "listing_not_saved": return "Enregistre la fiche avant de la publier.";
    case "listing_incomplete": return "Fiche incomplète : accroche (10 caractères), description (80 caractères) et connexion FiveM ou Discord.";
    case "listing_not_published": return "Publie d'abord la fiche dans l'annuaire.";
    case "invalid_days": return "Durée invalide (1 à 90 jours).";
    case "unknown_listing": return "Ce serveur n'est plus dans l'annuaire.";
    case "invalid_review": return "Avis invalide : une note de 1 à 5 et au moins 20 caractères.";
    case "review_login": return "Connecte-toi avec Discord pour laisser un avis.";
    case "review_not_played": return "Seuls les joueurs qui ont joué au moins 1 h sur ce serveur (compte Discord lié en jeu) peuvent laisser un avis.";
    case "review_staff": return "Tu fais partie de l'équipe de ce serveur : tu ne peux pas le noter.";
    case "review_removed": return "Ton avis a été retiré par la modération.";
    case "unknown_review": return "Avis introuvable.";
    case "own_review": return "Tu ne peux pas signaler ton propre avis.";
    case "invalid_reason": return "Explique en quelques mots pourquoi.";
    case "invalid_resource": return "Nom de ressource invalide (minuscules, chiffres, _ et -, 3 à 48 caractères).";
    case "unknown_creation": return "Création introuvable (supprimée ?).";
    case "unknown_version": return "Version introuvable.";
    case "nothing_to_deploy": return "Rien à déployer : la création n'a encore aucun fichier.";
    case "blocks_too_large": return "Trop de blocs : découpe ton script en plusieurs créations.";
    case "too_many_files": return "Trop de fichiers (25 au maximum).";
    case "file_too_large":
    case "files_too_large": return "Fichiers trop lourds (200 Ko par fichier, 400 Ko au total).";
    case "ai_not_configured": return "IA non configurée : ajoute AI_API_KEY dans l'environnement du site.";
    case "ai_unreadable": return "L'IA a répondu dans un format illisible : relance ou reformule.";
    case "ai_truncated": return "La réponse de l'IA a été coupée (trop longue) : demande une modification plus petite, ou augmente AI_CODE_MAX_TOKENS.";
    case "ai_rate_limited": return "Limite du service IA atteinte : réessaie dans une minute.";
    case "not_member": return "Ce serveur ne fait pas partie du réseau Fiverax.";
    case "invalid_resource": return "Ressource refusée (l'agent Fiverax ne se modifie pas).";
    case "unknown_resource": return "Cette ressource n'existe pas sur le serveur (recharge la liste).";
    case "unknown_change": return "Modification introuvable.";
    case "change_not_pending": return "Cette modification est déjà appliquée ou en cours.";
    case "change_not_applied": return "Seule une modification appliquée peut être annulée.";
    case "unknown_item": return "Cette création n'est plus dans la bibliothèque.";
    case "nothing_to_publish": return "Rien à publier : la création n'a encore aucun fichier.";
    case "has_errors": return "La création a des erreurs (onglet Vérifications) : corrige-les avant de la publier.";
    case "unsafe_code": return "Publication refusée : le scanner a trouvé du code dangereux (backdoor, commandes système, permissions admin…).";
    case "item_hidden": return "Cette publication est masquée après des signalements : elle attend la modération Fiverax.";
    case "own_item": return "Tu ne peux pas signaler une création de ton propre serveur.";
    case "already_reported": return "Ton serveur a déjà signalé cette création.";
    case "up_to_date": return "Déjà à jour.";
    case "unknown_report": return "Report introuvable.";
    case "unknown_capture": return "Replay introuvable (supprimé après 30 jours).";
    case "unknown_appeal": return "Contestation introuvable.";
    case "appeal_decided": return "Cette contestation a déjà été traitée.";
    case "invalid_appeal": return "Explique ta contestation en 30 à 2000 caractères.";
    case "ban_not_active": return "Ce ban est déjà levé ou terminé.";
    case "appeal_open": return "Tu as déjà une contestation en attente pour ce ban.";
    case "appeal_too_soon": return "Ta dernière contestation a été refusée il y a moins de 7 jours.";
    case "vote_cooldown": return "Tu as déjà voté pour ce serveur il y a moins de 2 h.";
    case "vote_young_account": return "Ton compte Discord est trop récent pour voter (30 jours minimum).";
    case "vote_same_address": return "Quelqu'un a déjà voté pour ce serveur depuis ta connexion il y a moins de 2 h.";
    case "invalid_vote_settings": return "Récompenses invalides : vérifie les montants, les objets et les quantités.";
    case "no_rewards": return "Ajoute au moins une récompense, ou désactive les récompenses.";
    case "not_installed": return "Cette création ne vient pas de la bibliothèque.";
    case "invalid_target": return "Adresse invalide : colle un lien cfx.re/join/xxxxxx ou une adresse ip:port (port 1024 à 65535).";
    case "rate_limited": return "Trop de scans depuis ta connexion : réessaie dans une heure.";
    case "unreachable": return "Le serveur ne répond pas sur cette adresse (éteint, port fermé, ou adresse de connexion différente).";
    case "unknown_host": return "Ce nom de domaine n'existe pas.";
    case "private_address": return "Adresse privée ou locale : seuls les serveurs publics peuvent être scannés.";
    case "cfx_unresolved": return "Cfx.re n'a pas donné l'adresse de ce code. Colle plutôt l'adresse du serveur (ip:port ou domaine:port, celle de ton hébergeur ou de txAdmin).";
    case "unknown_block": return "Ce bloc n'est pas dans la version publiée : publie d'abord le portail.";
    case "giveaway_drawn": return "Ce giveaway a déjà été tiré.";
    case "unknown_response": return "Cette réponse n'existe plus.";
    case "unknown_kit": return "Ressource du kit inconnue.";
    case "not_enough_days": return "Pas assez de jours gagnés.";
    default:
      if (data.error?.startsWith("tebex_")) return tebexErrorMessage(data.error, data.message);
      if (data.error?.startsWith("ai_http_")) return `Le service IA a refusé la demande (code ${data.error.slice(8)}).`;
      return `Erreur : ${data.error ?? status}`;
  }
}
