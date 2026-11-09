"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, RotateCcw, Save, Trash2 } from "lucide-react";
import { BOT_BIO_MAX, BOT_IMAGE_MAX_BYTES, BOT_NICK_MAX } from "@/lib/platform-shared";
import BotCard from "@/app/bot-card";
import { imageToDataUri, type ImageKind } from "@/app/image-file";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

/** keep: unchanged · set: a new image · remove: back to the bot's own. */
type ImageChange = { kind: "keep" } | { kind: "set"; dataUri: string } | { kind: "remove" };

type Props = {
  current: { nick: string | null; bio: string | null; avatarUrl: string | null; bannerUrl: string | null };
  base: { username: string; avatarUrl: string; bannerUrl: string | null; description: string };
};

/** The bot's name, avatar, banner and bio on this server's Discord, with a live preview of its profile. */
export default function BotProfileForm({ current, base }: Props) {
  const router = useRouter();
  const paths = useServerPaths();
  const { ask, toast } = useUI();
  const [nick, setNick] = useState(current.nick ?? "");
  const [bio, setBio] = useState(current.bio ?? "");
  const [avatar, setAvatar] = useState<ImageChange>({ kind: "keep" });
  const [banner, setBanner] = useState<ImageChange>({ kind: "keep" });
  const [busy, setBusy] = useState(false);
  const inputs = { avatar: useRef<HTMLInputElement>(null), banner: useRef<HTMLInputElement>(null) };

  const shown = (change: ImageChange, own: string | null, fallback: string | null) =>
    change.kind === "set" ? change.dataUri : change.kind === "remove" ? fallback : own ?? fallback;
  const dirty = nick !== (current.nick ?? "") || bio !== (current.bio ?? "") || avatar.kind !== "keep" || banner.kind !== "keep";

  async function pick(kind: ImageKind, file: File | undefined) {
    if (!file) return;
    try {
      const dataUri = await imageToDataUri(file, kind, BOT_IMAGE_MAX_BYTES);
      (kind === "avatar" ? setAvatar : setBanner)({ kind: "set", dataUri });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Image refusée.", "error");
    }
  }

  async function send(payload: Record<string, string | null>, success: string) {
    setBusy(true);
    try {
      const res = await fetch(paths.api("bot-profile"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast(describeApiError(data, res.status), "error");
      setAvatar({ kind: "keep" });
      setBanner({ kind: "keep" });
      toast(success, "ok");
      router.refresh();
    } catch {
      toast("Impossible de joindre le panel.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, string | null> = { nick: nick.trim() || null, bio: bio.trim() || null };
    for (const [key, change] of [["avatar", avatar], ["banner", banner]] as const) {
      if (change.kind === "set") payload[key] = change.dataUri;
      if (change.kind === "remove") payload[key] = null;
    }
    await send(payload, "Profil du bot mis à jour sur ton Discord.");
  }

  async function reset() {
    const ok = await ask({ title: "Rétablir le bot d'origine", message: "Le bot reprend son nom, son avatar, sa bannière et sa bio Fiverax sur ton Discord.", confirmLabel: "Rétablir" });
    if (!ok) return;
    setNick("");
    setBio("");
    await send({ nick: null, bio: null, avatar: null, banner: null }, "Le bot a repris son profil d'origine.");
  }

  const imageRow = (kind: ImageKind, label: string, hint: string, change: ImageChange, setChange: (c: ImageChange) => void, hasOwn: boolean) => (
    <div style={{ display: "grid", gap: 6 }}>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input ref={inputs[kind]} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { void pick(kind, e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" className="btn sm" disabled={busy} onClick={() => inputs[kind].current?.click()}><ImagePlus size={14} />Choisir une image</button>
        {(change.kind === "set" || (change.kind === "keep" && hasOwn)) && (
          <button type="button" className="btn sm" disabled={busy} onClick={() => setChange({ kind: "remove" })}><Trash2 size={14} />Retirer</button>
        )}
        {change.kind !== "keep" && <button type="button" className="linkish" onClick={() => setChange({ kind: "keep" })}>Annuler</button>}
        {change.kind === "set" && <span className="tag" data-tone="info">Nouvelle image</span>}
        {change.kind === "remove" && <span className="tag" data-tone="warn">Image d&apos;origine</span>}
      </div>
      <small className="muted">{hint}</small>
    </div>
  );

  return (
    <div className="cols two" style={{ alignItems: "start" }}>
      <form onSubmit={save} className="rise rise-1" style={{ display: "grid", gap: 20 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>Nom affiché sur ton Discord</span>
          <input className="field" maxLength={BOT_NICK_MAX} value={nick} onChange={(e) => setNick(e.target.value)} placeholder={base.username} />
          <small className="muted">{nick.length}/{BOT_NICK_MAX}. Vide : {base.username}.</small>
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>Bio (« À propos de moi »)</span>
          <textarea className="field" rows={4} maxLength={BOT_BIO_MAX} value={bio} onChange={(e) => setBio(e.target.value)} placeholder={base.description || "Le bot officiel de mon serveur : staff, anticheat et anti-raid."} />
          <small className="muted">{bio.length}/{BOT_BIO_MAX}. Vide : la bio Fiverax.</small>
        </label>
        {imageRow("avatar", "Avatar", "Carré, recadré au centre en 512 × 512. PNG, JPG, WebP ou GIF animé (1,5 Mo).", avatar, setAvatar, Boolean(current.avatarUrl))}
        {imageRow("banner", "Bannière", "Recadrée en 1020 × 360 (le format d'un profil Discord). PNG, JPG, WebP ou GIF animé (1,5 Mo).", banner, setBanner, Boolean(current.bannerUrl))}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn primary" disabled={busy || !dirty}><Save size={15} />{busy ? "Envoi à Discord…" : "Enregistrer"}</button>
          <button type="button" className="btn" disabled={busy} onClick={reset}><RotateCcw size={15} />Rétablir le bot d&apos;origine</button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Visible uniquement sur ton serveur Discord : ailleurs, le bot garde son profil Fiverax. Discord limite les changements d&apos;image à quelques-uns par heure.
        </p>
      </form>
      <div className="rise rise-2" style={{ display: "grid", gap: 10, justifyItems: "start" }}>
        <small className="eyebrow">Aperçu sur ton Discord</small>
        <BotCard
          name={nick.trim() || base.username}
          bio={bio.trim() || base.description || null}
          avatarUrl={shown(avatar, current.avatarUrl, base.avatarUrl)}
          bannerUrl={shown(banner, current.bannerUrl, base.bannerUrl)}
          caption="Le profil que voient tes membres en cliquant sur le bot."
        />
      </div>
    </div>
  );
}
