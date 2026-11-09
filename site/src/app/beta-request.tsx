"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import { describeApiError, useUI } from "./ui";

type Request = { serverName: string; link: string | null; players: string | null; message: string | null; status: "pending" | "approved" | "refused"; updatedAt: string } | null;

/** Ask to join the private beta (shown on /servers to accounts that are not partners yet). */
export default function BetaRequest({ initial }: { initial: Request }) {
  const { toast } = useUI();
  const [request, setRequest] = useState(initial);
  const [editing, setEditing] = useState(!initial || initial.status === "refused");
  const [form, setForm] = useState({ serverName: initial?.serverName ?? "", link: initial?.link ?? "", players: initial?.players ?? "", message: initial?.message ?? "" });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/beta?action=request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast(describeApiError(data, res.status), "error");
      setRequest(data.request);
      setEditing(false);
      toast("Demande envoyée : on te répond très vite.", "ok");
    } catch {
      toast("Impossible de joindre Fiverax.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (request && !editing) {
    return (
      <div style={{ marginTop: 16 }}>
        {request.status === "pending" && <p><span className="tag" data-tone="info">Demande envoyée</span> pour <b>{request.serverName}</b>. Tu seras prévenu dès que ton accès est ouvert : il suffira de revenir sur cette page.</p>}
        {request.status === "refused" && <p><span className="tag" data-tone="warn">Pas cette fois</span> Ta demande n&apos;a pas été retenue pour cette vague de la bêta.</p>}
        <button type="button" className="linkish" onClick={() => setEditing(true)}>Modifier ma demande</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12, marginTop: 16, maxWidth: 560 }}>
      <label style={{ display: "grid", gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>Nom de ton serveur FiveM *</span>
        <input className="field" required minLength={2} maxLength={80} value={form.serverName} onChange={(e) => setForm({ ...form, serverName: e.target.value })} placeholder="Los Santos RP" />
      </label>
      <label style={{ display: "grid", gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>Lien (Discord, cfx.re/join ou site)</span>
        <input className="field" maxLength={200} value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://discord.gg/… ou cfx.re/join/abc123" />
      </label>
      <label style={{ display: "grid", gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>Joueurs en moyenne</span>
        <input className="field" maxLength={40} value={form.players} onChange={(e) => setForm({ ...form, players: e.target.value })} placeholder="ex. 40 le soir" />
      </label>
      <label style={{ display: "grid", gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>Un mot sur ton projet (facultatif)</span>
        <textarea className="field" rows={3} maxLength={1000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Ce que tu attends de Fiverax, ton framework (ESX, QBCore…)" />
      </label>
      <div><button className="btn primary" disabled={busy}><Send size={15} />{request ? "Mettre à jour ma demande" : "Demander l'accès"}</button></div>
    </form>
  );
}
