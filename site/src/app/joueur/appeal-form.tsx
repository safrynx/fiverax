"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { describeApiError, useUI } from "@/app/ui";

const MIN = 30;
const MAX = 2000;

/** Contest one of the player's active bans: the staff reads it in Reports > Contestations and answers here. */
export default function AppealForm({ serverId, banId }: { serverId: string; banId: number }) {
  const router = useRouter();
  const { toast } = useUI();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/portal?action=appeal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serverId, banId, body }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast(describeApiError(data, res.status), "error");
      toast("Contestation envoyée au staff du serveur.", "ok");
      setOpen(false);
      router.refresh();
    } catch {
      toast("Impossible de joindre Fiverax.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => setOpen(true)}>Contester ce ban</button>;
  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8 }}>
      <textarea
        className="field" rows={5} value={body} maxLength={MAX} onChange={(e) => setBody(e.target.value)}
        placeholder="Explique calmement ce qui s'est passé de ton point de vue, et pourquoi le ban devrait être levé ou réduit."
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn primary sm" disabled={busy || body.trim().length < MIN}>Envoyer au staff</button>
        <button type="button" className="btn sm" onClick={() => setOpen(false)}>Annuler</button>
        <span className="muted" style={{ fontSize: 12 }}>{body.trim().length < MIN ? `${MIN - body.trim().length} caractères de plus minimum` : `${body.length}/${MAX}`}</span>
      </div>
    </form>
  );
}
