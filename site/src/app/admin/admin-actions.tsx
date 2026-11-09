"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { describeApiError, useUI } from "@/app/ui";

/** POST /api/admin?action=… ; null on failure (a toast already explains it). */
async function callAdmin(action: string, payload: Record<string, unknown>, toast: (m: string, k?: "ok" | "error" | "info") => void): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`/api/admin?action=${encodeURIComponent(action)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      toast(describeApiError(data as { error?: string }, res.status), "error");
      return null;
    }
    return data;
  } catch {
    toast("Impossible de joindre le panel.", "error");
    return null;
  }
}

type Confirm = {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  /** Ask for a text (a reason, the id to type): it goes into `payload[field]`. Required unless `optional`. */
  input?: { label: string; placeholder?: string; multiline?: boolean; field: string; optional?: boolean };
};

/** One button = one admin action, behind a confirmation dialog when `confirm` is set. Refreshes the page after. */
export function AdminAction({
  action, payload, confirm, success, redirectTo, className = "btn sm", children
}: {
  action: string;
  payload: Record<string, unknown>;
  confirm?: Confirm;
  success?: string;
  redirectTo?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { ask, toast } = useUI();
  const [busy, setBusy] = useState(false);

  async function run() {
    const body = { ...payload };
    if (confirm) {
      const answer = await ask({
        title: confirm.title, message: confirm.message, confirmLabel: confirm.confirmLabel, danger: confirm.danger,
        input: confirm.input ? { label: confirm.input.label, placeholder: confirm.input.placeholder, multiline: confirm.input.multiline, required: !confirm.input.optional } : undefined
      });
      if (!answer) return;
      if (confirm.input) body[confirm.input.field] = answer.value;
    }
    setBusy(true);
    try {
      const data = await callAdmin(action, body, toast);
      if (!data) return;
      if (success) toast(typeof data.sessionsClosed === "number" ? `${success} (${data.sessionsClosed} session(s) fermée(s))` : success, "ok");
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return <button type="button" className={className} disabled={busy} onClick={run}>{children}</button>;
}

/** Add an owner to a server by Discord id. */
export function AddOwnerForm({ serverId }: { serverId: string }) {
  const router = useRouter();
  const { toast } = useUI();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="adm-actions"
      style={{ marginTop: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          if (await callAdmin("server_owner_add", { serverId, discordId: value.trim() }, toast)) {
            toast("Propriétaire ajouté.", "ok");
            setValue("");
            router.refresh();
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className="field" required pattern="\d{17,20}" value={value} onChange={(e) => setValue(e.target.value)} placeholder="ID Discord du nouveau propriétaire" style={{ width: "auto", minWidth: 260 }} />
      <button className="btn sm" disabled={busy}>Ajouter un propriétaire</button>
    </form>
  );
}

/** Make any Discord account a beta partner (even before its first login). */
export function AddPartnerForm() {
  const router = useRouter();
  const { toast } = useUI();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="adm-actions"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          if (await callAdmin("partner_add", { discordId: value.trim() }, toast)) {
            toast("Partenaire ajouté : il peut ajouter son serveur dès maintenant.", "ok");
            setValue("");
            router.refresh();
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className="field" required pattern="\d{17,20}" value={value} onChange={(e) => setValue(e.target.value)} placeholder="ID Discord du partenaire" style={{ width: "auto", minWidth: 240 }} />
      <button className="btn sm primary" disabled={busy}>Ajouter un partenaire</button>
    </form>
  );
}

/** Ban an account that never logged in (or any id), from the accounts list. */
export function BanByIdForm() {
  const router = useRouter();
  const { ask, toast } = useUI();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="adm-actions"
      onSubmit={async (e) => {
        e.preventDefault();
        const discordId = value.trim();
        const answer = await ask({
          title: "Bannir ce compte Discord",
          message: `Le compte ${discordId} ne pourra plus se connecter à Fiverax, ses sessions ouvertes se ferment.`,
          confirmLabel: "Bannir", danger: true,
          input: { label: "Raison (gardée dans le journal)", required: true, multiline: true }
        });
        if (!answer) return;
        setBusy(true);
        try {
          if (await callAdmin("user_ban", { discordId, reason: answer.value }, toast)) {
            toast("Compte banni.", "ok");
            setValue("");
            router.refresh();
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className="field" required pattern="\d{17,20}" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Bannir un ID Discord" style={{ width: "auto", minWidth: 220 }} />
      <button className="btn sm danger" disabled={busy}>Bannir</button>
    </form>
  );
}
