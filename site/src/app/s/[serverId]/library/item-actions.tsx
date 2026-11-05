"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, EyeOff, Flag, Heart, PackageOpen, ShieldCheck, Trash2 } from "lucide-react";
import type { CreationKind } from "@/lib/studio-shared";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

type Props = {
  itemId: number;
  title: string;
  kind: CreationKind;
  status: "published" | "hidden" | "removed";
  liked: boolean;
  likes: number;
  installed: { creationId: number; version: number } | null;
  latestVersion: number;
  mine: boolean;
  can: { install: boolean; publish: boolean; moderate: boolean };
};

/** Install, like, report; withdraw (publisher); moderate (platform owners). */
export default function ItemActions(p: Props) {
  const router = useRouter();
  const paths = useServerPaths();
  const { ask, toast } = useUI();
  const [busy, setBusy] = useState(false);
  const [liked, setLiked] = useState(p.liked);
  const [likes, setLikes] = useState(p.likes);

  async function post(kind: string, body: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    try {
      const res = await fetch(paths.api(`library?kind=${kind}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(describeApiError(data, res.status), "error");
        return null;
      }
      return data;
    } catch {
      toast("Impossible de joindre le panel.", "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    if (p.installed) {
      const again = await ask({ title: "Installer une deuxième copie ?", message: "Ce serveur a déjà cette création dans son Studio. Une nouvelle copie sera créée avec un autre nom de ressource.", confirmLabel: "Installer quand même" });
      if (!again) return;
    }
    const data = await post("install", { itemId: p.itemId });
    if (!data) return;
    toast(`« ${p.title} » est dans ton Studio : vérifie-la puis déploie-la.`, "ok");
    router.push(paths.page(`/studio/${data.kind}/${data.creationId}`));
  }

  async function like() {
    const data = await post("like", { itemId: p.itemId });
    if (!data) return;
    setLiked(Boolean(data.liked));
    setLikes(Number(data.likes));
  }

  async function report() {
    const answer = await ask({
      title: "Signaler cette création",
      message: "Code malveillant, contenu volé, ne fonctionne pas du tout… Après 3 signalements de serveurs différents, elle est masquée jusqu'à vérification par Fiverax.",
      confirmLabel: "Signaler",
      danger: true,
      input: { label: "Raison", required: true, multiline: true, placeholder: "Ce qui ne va pas" }
    });
    if (!answer || answer.value.length < 5) return;
    const data = await post("report", { itemId: p.itemId, reason: answer.value });
    if (data) {
      toast(data.hidden ? "Merci : la création est masquée en attendant la vérification." : "Merci, le signalement est enregistré.", "ok");
      router.refresh();
    }
  }

  async function unpublish() {
    const ok = await ask({ title: `Retirer « ${p.title} » de la bibliothèque ?`, message: "Les serveurs qui l'ont installée gardent leur copie, mais ne recevront plus de mise à jour.", confirmLabel: "Retirer", danger: true });
    if (ok && (await post("unpublish", { itemId: p.itemId }))) {
      toast("Création retirée de la bibliothèque.", "ok");
      router.push(paths.page("/library"));
    }
  }

  async function moderate(status: "published" | "removed") {
    const ok = await ask({ title: status === "published" ? "Remettre en ligne ?" : "Supprimer de la bibliothèque ?", message: status === "published" ? "Les signalements sont effacés." : "Plus personne ne la verra.", confirmLabel: "Confirmer", danger: status === "removed" });
    if (ok && (await post("moderate", { itemId: p.itemId, status }))) {
      toast("C'est fait.", "ok");
      router.refresh();
    }
  }

  const live = p.status === "published";
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {live && p.can.install && (
        p.installed && !p.mine ? (
          <>
            <Link className="btn" href={paths.page(`/studio/${p.kind}/${p.installed.creationId}`)}><PackageOpen size={14} />Ouvrir ma copie{p.installed.version < p.latestVersion ? " (mise à jour dispo)" : ""}</Link>
            <button className="btn" disabled={busy} onClick={install}><Download size={14} />Réinstaller</button>
          </>
        ) : (
          <button className="btn primary" disabled={busy} onClick={install}><Download size={14} />Installer dans mon Studio</button>
        )
      )}
      {live && !p.mine && (
        <button className="btn" disabled={busy} onClick={like} data-on={liked} title={liked ? "Retirer le j'aime" : "J'aime"}>
          <Heart size={14} fill={liked ? "currentColor" : "none"} />{likes}
        </button>
      )}
      {live && !p.mine && <button className="ibtn bad" disabled={busy} title="Signaler" onClick={report}><Flag size={13} /></button>}
      {p.mine && p.can.publish && p.status !== "removed" && <button className="btn danger" disabled={busy} onClick={unpublish}><EyeOff size={14} />Retirer</button>}
      {p.can.moderate && p.status !== "published" && <button className="btn" disabled={busy} onClick={() => moderate("published")}><ShieldCheck size={14} />Remettre en ligne</button>}
      {p.can.moderate && p.status !== "removed" && <button className="btn danger" disabled={busy} onClick={() => moderate("removed")}><Trash2 size={14} />Supprimer (modération)</button>}
    </div>
  );
}
