"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import CopyButton from "@/app/copy-button";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

type Props = {
  name: string;
  guildId: string | null;
  timezone: string | null;
  reviewHour: number | null;
  defaultTimezone: string;
  defaultReviewHour: number;
  /** Platform owners type any guild ID; other owners pick one of the guilds they manage. */
  freeGuildInput: boolean;
  guildOptions: { id: string; name: string }[];
  hasFivemToken: boolean;
  appUrl: string;
  agent: { linked: boolean; online: boolean; version: string | null };
  /** Version of the agent the panel hands out (download button); the server's one is compared to it. */
  latestAgent: string;
  inviteUrl: string | null;
};

/** Pure: is version a older than b ("3.6.0" < "3.8.0")? */
const older = (a: string, b: string) => {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
};

/** The server's identity (name, Discord guild, time zone) and the token of its FiveM agent. */
export default function ServerSettings(props: Props) {
  const router = useRouter();
  const { ask, toast } = useUI();
  const paths = useServerPaths();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(props.name);
  const [guildId, setGuildId] = useState(props.guildId ?? "");
  const [timezone, setTimezone] = useState(props.timezone ?? "");
  const [reviewHour, setReviewHour] = useState(props.reviewHour === null ? "" : String(props.reviewHour));
  const [token, setToken] = useState<string | null>(null);

  async function post(kind: string, payload: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    try {
      const res = await fetch(paths.api(`access?kind=${kind}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(describeApiError(data, res.status), "error");
        return null;
      }
      return data;
    } catch {
      toast("Impossible de joindre le serveur.", "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      name: name.trim(),
      timezone: timezone.trim(),
      reviewHour: reviewHour === "" ? null : Number(reviewHour)
    };
    if (guildId.trim() !== (props.guildId ?? "")) payload.guildId = guildId.trim() || null;
    if (await post("server_update", payload)) {
      toast("Serveur enregistré", "ok");
      router.refresh();
    }
  }

  async function rotate() {
    if (props.hasFivemToken) {
      const answer = await ask({ title: "Nouveau token FiveM", message: "L'ancien token cessera de fonctionner : il faudra mettre le nouveau dans le server.cfg.", confirmLabel: "Générer", danger: true });
      if (!answer) return;
    }
    const data = await post("fivem_token_rotate", {});
    if (data?.token) {
      setToken(String(data.token));
      router.refresh();
    }
  }

  const cfg = token
    ? `set fiverax_url "${props.appUrl}"\nset fiverax_token "${token}"\nadd_ace resource.fiverax_agent command allow\nadd_ace group.admin fiverax.bypass allow\nensure screenshot-basic\nensure fiverax_agent`
    : "";
  const agentTag = !props.agent.linked
    ? { tone: "neutral", label: "Agent jamais connecté" }
    : props.agent.online
      ? { tone: "up", label: `Agent en ligne${props.agent.version ? ` · v${props.agent.version}` : ""}` }
      : { tone: "warn", label: "Agent hors ligne" };

  return (
    <div className="cols" style={{ gap: 56, marginBottom: 56 }}>
      <section className="rise rise-1">
        <header style={{ paddingBottom: 12, borderBottom: "1px solid var(--line-2)" }}>
          <h2 className="h2">Serveur</h2>
          <p className="muted" style={{ margin: "6px 0 0" }}>Nom affiché, serveur Discord suivi par le bot, et fuseau horaire de la communauté (semaines et bilan du dimanche).</p>
        </header>
        <form onSubmit={save} style={{ display: "grid", gap: 12, marginTop: 18, maxWidth: 520 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Nom</span>
            <input required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className="field" />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Serveur Discord{props.freeGuildInput ? " (ID)" : " · parmi ceux où tu as « Gérer le serveur »"}</span>
            {props.freeGuildInput ? (
              <input value={guildId} onChange={(e) => setGuildId(e.target.value)} placeholder="ex. 123456789012345678" pattern="\d{17,20}" className="field" />
            ) : (
              <select value={guildId} onChange={(e) => setGuildId(e.target.value)} className="field">
                {!props.guildId && <option value="">Choisir un serveur Discord…</option>}
                {props.guildId && !props.guildOptions.some((g) => g.id === props.guildId) && <option value={props.guildId}>{props.guildId} (actuel)</option>}
                {props.guildOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
          </label>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Fuseau horaire</span>
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder={`${props.defaultTimezone} (par défaut)`} className="field" />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Heure du bilan IA</span>
              <input type="number" min={0} max={23} value={reviewHour} onChange={(e) => setReviewHour(e.target.value)} placeholder={`${props.defaultReviewHour} h`} className="field" />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn primary" disabled={busy}>Enregistrer</button>
            {props.inviteUrl && <a href={props.inviteUrl} target="_blank" rel="noreferrer" className="linkish">Inviter le bot sur ce serveur Discord</a>}
          </div>
        </form>
      </section>

      <section className="rise rise-2">
        <header style={{ paddingBottom: 12, borderBottom: "1px solid var(--line-2)" }}>
          <h2 className="h2">Agent FiveM</h2>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            La ressource <code>fiverax_agent</code> relie le serveur FiveM au panel : joueurs en direct, carte, anticheat, bans, écrans des joueurs, console et ressources.
            Elle appelle le panel toutes les quelques secondes avec le token de ce serveur : aucun port à ouvrir. <a href="/guides/agent-fivem" className="linkish">Tutoriel d&apos;installation</a>
          </p>
        </header>
        <p style={{ marginTop: 18 }}>
          <span className="tag" data-tone={props.hasFivemToken ? "up" : "warn"}>{props.hasFivemToken ? "Token configuré" : "Aucun token"}</span>{" "}
          {props.hasFivemToken && <span className="tag" data-tone={agentTag.tone}>{agentTag.label}</span>}
        </p>
        {props.agent.version && older(props.agent.version, props.latestAgent) && (
          <div className="banner"><b>Mise à jour disponible :</b> ton serveur utilise l&apos;agent {props.agent.version}, la version {props.latestAgent} apporte les dernières protections. Télécharge-la ci-dessous, remplace le dossier <code>fiverax_agent</code>, puis <code>ensure fiverax_agent</code>.</div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <a href="/api/agent/download" className="btn primary" download>Télécharger l&apos;agent ({props.latestAgent})</a>
          <button className="btn" disabled={busy} onClick={rotate}>{props.hasFivemToken ? "Générer un nouveau token" : "Générer le token"}</button>
        </div>
        {token && (
          <div className="banner" style={{ marginTop: 16 }}>
            <b>À copier maintenant : ce token ne sera plus jamais affiché.</b> Ajoute ces lignes au <code>server.cfg</code> du serveur FiveM :
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "10px 0" }}>{cfg}</pre>
            <CopyButton text={cfg} label="Copier" />
            <p style={{ margin: "10px 0 0" }}>La ligne <code>add_ace</code> autorise l&apos;agent à gérer les ressources et à exécuter les commandes de la console. Pour refuser la console depuis le panel, ajoute <code>set fiverax_console 0</code>. <code>fiverax.bypass</code> exempte ton staff de l&apos;anticheat ; <code>screenshot-basic</code> (facultatif) permet les captures analysées par l&apos;IA.</p>
          </div>
        )}
      </section>
    </div>
  );
}
