"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

type AskInput = { label: string; placeholder?: string; required?: boolean; multiline?: boolean; initial?: string };
export type AskOptions = { title: string; message?: string; confirmLabel?: string; danger?: boolean; input?: AskInput };
type ToastKind = "ok" | "error" | "info";

type UIContext = {
  /** In-page replacement for confirm()/prompt(): resolves with the typed value, or null when cancelled. */
  ask: (options: AskOptions) => Promise<{ value: string } | null>;
  toast: (message: string, kind?: ToastKind) => void;
};

const Ctx = createContext<UIContext | null>(null);

export function useUI(): UIContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUI must be used inside <UIProvider>");
  return ctx;
}

type Pending = { options: AskOptions; resolve: (value: { value: string } | null) => void };

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: ToastKind }[]>([]);
  const [value, setValue] = useState("");
  const nextId = useRef(1);

  const ask = useCallback<UIContext["ask"]>(
    (options) =>
      new Promise((resolve) => {
        setValue(options.input?.initial ?? "");
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
    (result: { value: string } | null) => {
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
              close({ value: value.trim() });
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
export function describeApiError(data: { error?: string; discordStatus?: number; permission?: string }, status: number): string {
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
    default:
      if (data.error?.startsWith("ai_http_")) return `Le service IA a refusé la demande (code ${data.error.slice(8)}).`;
      return `Erreur : ${data.error ?? status}`;
  }
}
