"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Film } from "lucide-react";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { res, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Refresh the server-rendered list now and then (new reports), only while the tab is visible. */
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}

/** Ask the agent for its black box now (around one player, or the whole server). */
export function CaptureButton({ players, online }: { players: { id: number; name: string }[]; online: boolean }) {
  const paths = useServerPaths();
  const router = useRouter();
  const { ask, toast } = useUI();
  const [busy, setBusy] = useState(false);

  async function capture() {
    const who = await ask({
      title: "Capturer les dernières minutes",
      message: "L'agent envoie ce qu'il a gardé en mémoire (5 min par défaut). Autour d'un joueur : seulement ceux qui sont passés à moins de 300 m de lui.",
      confirmLabel: "Capturer",
      select: {
        label: "Autour de",
        options: [{ value: "", label: "Tout le serveur" }, ...players.map((p) => ({ value: String(p.id), label: `${p.name} (#${p.id})` }))],
        initial: ""
      },
      input: { label: "Pourquoi (facultatif)", placeholder: "Fusillade place des cubes, plainte sur Discord…" }
    });
    if (!who) return;
    setBusy(true);
    try {
      const { res, data } = await postJson(paths.api("reports?action=capture"), {
        ...(who.choice ? { center: Number(who.choice) } : {}),
        ...(who.value.trim() ? { reason: who.value.trim() } : {})
      });
      if (!res.ok) return toast(describeApiError(data, res.status), "error");
      toast("Capture demandée : elle apparaît dans la liste dans quelques secondes.", "ok");
      setTimeout(() => router.refresh(), 6000);
    } catch {
      toast("Impossible de joindre le panel.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn primary" disabled={busy || !online} onClick={capture} title={online ? undefined : "Le serveur FiveM ne répond pas"}>
      <Film size={14} />Capturer maintenant
    </button>
  );
}

export function AppealActions({ id, name }: { id: number; name: string }) {
  const paths = useServerPaths();
  const router = useRouter();
  const { ask, toast } = useUI();
  const [busy, setBusy] = useState(false);

  async function decide(accept: boolean) {
    const answer = await ask({
      title: accept ? `Débannir ${name} ?` : `Refuser la contestation de ${name} ?`,
      message: accept ? "Le ban est levé tout de suite. Le joueur lit ta réponse dans son espace joueur." : "Le joueur lit ta réponse dans son espace joueur et pourra recontester dans 7 jours.",
      confirmLabel: accept ? "Accepter et débannir" : "Refuser",
      danger: !accept,
      input: { label: "Réponse au joueur", multiline: true, required: !accept, placeholder: accept ? "Ok pour cette fois, relis le règlement." : "Les preuves sont claires : le ban est maintenu." }
    });
    if (!answer) return;
    setBusy(true);
    try {
      const { res, data } = await postJson(paths.api("reports?action=appeal"), { id, accept, response: answer.value });
      if (!res.ok) return toast(describeApiError(data, res.status), "error");
      toast(accept ? `${name} est débanni.` : "Contestation refusée.", "ok");
      router.refresh();
    } catch {
      toast("Impossible de joindre le panel.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className="btn primary" disabled={busy} onClick={() => decide(true)}>Accepter et débannir</button>
      <button className="btn" disabled={busy} onClick={() => decide(false)}>Refuser</button>
    </div>
  );
}
