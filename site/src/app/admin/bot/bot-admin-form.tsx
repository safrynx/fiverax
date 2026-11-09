"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Save, Trash2 } from "lucide-react";
import { BOT_ACTIVITIES, BOT_IMAGE_MAX_BYTES, BOT_STATUSES, type PlatformSettings } from "@/lib/platform-shared";
import BotCard from "../../bot-card";
import { imageToDataUri, type ImageKind } from "../../image-file";
import { describeApiError, useUI } from "../../ui";

type Identity = { id: string; username: string; avatarUrl: string; bannerUrl: string | null; description: string };
type ImageChange = { kind: "keep" } | { kind: "set"; dataUri: string } | { kind: "remove" };
type Presence = PlatformSettings["bot"];

const DOT: Record<Presence["status"], string> = { online: "#23a55a", idle: "#f0b232", dnd: "#f23f43", invisible: "#80848e" };

async function post(action: string, payload: unknown): Promise<{ ok: boolean; data: Record<string, unknown>; status: number }> {
  const res = await fetch(`/api/admin?action=${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
  const data = res ? ((await res.json().catch(() => ({}))) as Record<string, unknown>) : { error: "network" };
  return { ok: Boolean(res?.ok), data, status: res?.status ?? 0 };
}

/** The shared bot everywhere: its Discord identity (username, avatar, banner, About me) and its status / activity. */
export default function BotAdminForm({ identity, presence: initialPresence, watched }: { identity: Identity; presence: Presence; watched: number }) {
  const router = useRouter();
  const { ask, toast } = useUI();
  const [username, setUsername] = useState(identity.username);
  const [description, setDescription] = useState(identity.description);
  const [avatar, setAvatar] = useState<ImageChange>({ kind: "keep" });
  const [banner, setBanner] = useState<ImageChange>({ kind: "keep" });
  const [presence, setPresence] = useState(initialPresence);
  const [busy, setBusy] = useState(false);
  const inputs = { avatar: useRef<HTMLInputElement>(null), banner: useRef<HTMLInputElement>(null) };

  const shown = (c: ImageChange, own: string | null) => (c.kind === "set" ? c.dataUri : c.kind === "remove" ? null : own);
  const identityDirty = username !== identity.username || description !== identity.description || avatar.kind !== "keep" || banner.kind !== "keep";
  const activityLine = presence.activityType === "none" || !presence.activityText.trim()
    ? null
    : `${presence.activityType === "custom" ? "" : `${BOT_ACTIVITIES[presence.activityType]} `}${presence.activityText.replace(/\{serveurs\}/g, String(watched))}`;

  async function pick(kind: ImageKind, file: File | undefined) {
    if (!file) return;
    try {
      const dataUri = await imageToDataUri(file, kind, BOT_IMAGE_MAX_BYTES);
      (kind === "avatar" ? setAvatar : setBanner)({ kind: "set", dataUri });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Image refusée.", "error");
    }
  }

  async function saveIdentity(e: React.FormEvent) {
    e.preventDefault();
    if (username !== identity.username) {
      const ok = await ask({ title: "Changer le nom du bot", message: "Le nouveau nom s'affiche sur tous les serveurs Discord (sauf ceux qui ont choisi un nom à eux). Discord n'autorise que 2 changements de nom par heure.", confirmLabel: "Changer" });
      if (!ok) return;
    }
    const payload: Record<string, unknown> = {};
    if (username !== identity.username) payload.username = username.trim();
    if (description !== identity.description) payload.description = description;
    for (const [key, change] of [["avatar", avatar], ["banner", banner]] as const) {
      if (change.kind === "set") payload[key] = change.dataUri;
      if (change.kind === "remove") payload[key] = null;
    }
    setBusy(true);
    try {
      const res = await post("bot_identity", payload);
      if (!res.ok) return toast(describeApiError(res.data as { error?: string }, res.status), "error");
      setAvatar({ kind: "keep" });
      setBanner({ kind: "keep" });
      toast("Profil du bot mis à jour sur Discord.", "ok");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function savePresence(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await post("bot_presence", { presence });
      if (!res.ok) return toast(describeApiError(res.data as { error?: string }, res.status), "error");
      toast("Statut enregistré : le bot l'applique d'ici 30 secondes.", "ok");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const imageRow = (kind: ImageKind, label: string, change: ImageChange, setChange: (c: ImageChange) => void, hasOwn: boolean) => (
    <div className="adm-row">
      <label>{label}</label>
      <div className="adm-actions">
        <input ref={inputs[kind]} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { void pick(kind, e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" className="btn sm" disabled={busy} onClick={() => inputs[kind].current?.click()}><ImagePlus size={14} />Choisir une image</button>
        {(change.kind === "set" || (change.kind === "keep" && hasOwn)) && <button type="button" className="btn sm" disabled={busy} onClick={() => setChange({ kind: "remove" })}><Trash2 size={14} />Retirer</button>}
        {change.kind !== "keep" && <button type="button" className="linkish" onClick={() => setChange({ kind: "keep" })}>Annuler</button>}
      </div>
      <small>{kind === "avatar" ? "Recadré en 512 × 512." : "Recadrée en 1020 × 360."} PNG, JPG, WebP ou GIF animé (1,5 Mo).</small>
    </div>
  );

  return (
    <div className="cols two" style={{ alignItems: "start" }}>
      <div className="adm-form">
        <form onSubmit={saveIdentity}>
          <fieldset>
            <legend>Identité (partout)</legend>
            <div className="adm-row">
              <label htmlFor="bot-name">Nom d&apos;utilisateur</label>
              <input id="bot-name" className="field" minLength={2} maxLength={32} required value={username} onChange={(e) => setUsername(e.target.value)} />
              <small>2 changements par heure au maximum (règle de Discord).</small>
            </div>
            <div className="adm-row">
              <label htmlFor="bot-about">À propos de moi</label>
              <textarea id="bot-about" className="field" rows={4} maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} />
              <small>{description.length}/400. Les serveurs peuvent mettre leur propre bio sur leur Discord.</small>
            </div>
            {imageRow("avatar", "Avatar", avatar, setAvatar, true)}
            {imageRow("banner", "Bannière", banner, setBanner, Boolean(identity.bannerUrl))}
            <div className="adm-actions" style={{ marginTop: 16 }}>
              <button className="btn primary" disabled={busy || !identityDirty}><Save size={15} />Enregistrer l&apos;identité</button>
            </div>
          </fieldset>
        </form>

        <form onSubmit={savePresence}>
          <fieldset>
            <legend>Statut et activité</legend>
            <div className="adm-nums">
              <div className="adm-row">
                <label htmlFor="bot-status">Statut</label>
                <select id="bot-status" className="field" value={presence.status} onChange={(e) => setPresence({ ...presence, status: e.target.value as Presence["status"] })}>
                  {Object.entries(BOT_STATUSES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </div>
              <div className="adm-row">
                <label htmlFor="bot-activity">Activité</label>
                <select id="bot-activity" className="field" value={presence.activityType} onChange={(e) => setPresence({ ...presence, activityType: e.target.value as Presence["activityType"] })}>
                  {Object.entries(BOT_ACTIVITIES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </div>
            </div>
            <div className="adm-row">
              <label htmlFor="bot-text">Texte</label>
              <input id="bot-text" className="field" maxLength={128} disabled={presence.activityType === "none"} value={presence.activityText} onChange={(e) => setPresence({ ...presence, activityText: e.target.value })} />
              <small><code>{"{serveurs}"}</code> devient le nombre de serveurs Discord protégés ({watched} en ce moment).</small>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: "12px 0 0", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: DOT[presence.status], display: "inline-block" }} />
              {activityLine ?? "Aucune activité affichée"}
            </p>
            <div className="adm-actions" style={{ marginTop: 16 }}>
              <button className="btn primary" disabled={busy}><Save size={15} />Enregistrer le statut</button>
            </div>
          </fieldset>
        </form>
      </div>

      <div style={{ display: "grid", gap: 10, justifyItems: "start" }}>
        <small className="eyebrow">Aperçu</small>
        <BotCard
          name={username || identity.username}
          bio={description || null}
          avatarUrl={shown(avatar, identity.avatarUrl)}
          bannerUrl={shown(banner, identity.bannerUrl)}
          caption={activityLine ?? undefined}
        />
      </div>
    </div>
  );
}
