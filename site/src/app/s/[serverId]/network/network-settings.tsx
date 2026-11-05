"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Network, Save } from "lucide-react";
import { BAN_CATEGORIES, NETWORK_MODES, type BanCategory, type NetworkSettings } from "@/lib/network-shared";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

/** Join the network / change its settings / leave it (owners). */
export default function NetworkSettingsForm({ initial, member }: { initial: NetworkSettings; member: boolean }) {
  const router = useRouter();
  const paths = useServerPaths();
  const { ask, toast } = useUI();
  const [s, setS] = useState<NetworkSettings>(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof NetworkSettings>(key: K, value: NetworkSettings[K]) => setS((prev) => ({ ...prev, [key]: value }));

  async function post(kind: "save" | "leave", body: unknown): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(paths.api(`network?kind=${kind}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(describeApiError(data, res.status), "error");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      toast("Impossible de joindre le panel.", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!member) {
      const ok = await ask({
        title: "Rejoindre le réseau Fiverax ?",
        message: "Tes bans partagés deviennent visibles par les autres serveurs du réseau (pseudo, raison, catégorie, date ; jamais les identifiants). En échange, tu vois les leurs. Tu peux garder un ban privé, ou quitter le réseau à tout moment.",
        confirmLabel: "Rejoindre"
      });
      if (!ok) return;
    }
    if (await post("save", s)) toast(member ? "Réglages du réseau enregistrés." : "Bienvenue dans le réseau Fiverax !", "ok");
  }

  async function leave() {
    const ok = await ask({ title: "Quitter le réseau ?", message: "Tes bans ne sont plus partagés et tu ne vois plus ceux des autres serveurs. Tes créations publiées restent dans la bibliothèque.", confirmLabel: "Quitter", danger: true });
    if (ok && (await post("leave", {}))) toast("Ton serveur a quitté le réseau.", "ok");
  }

  const toggleCategory = (key: BanCategory) =>
    set("blockCategories", s.blockCategories.includes(key) ? s.blockCategories.filter((c) => c !== key) : [...s.blockCategories, key]);

  return (
    <div className="form-col" style={{ maxWidth: "none" }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>À la connexion d&apos;un joueur banni ailleurs</div>
        <div className="seg">
          {NETWORK_MODES.map((m) => <button key={m.key} type="button" data-on={s.mode === m.key} onClick={() => set("mode", m.key)}>{m.label}</button>)}
        </div>
        <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>{NETWORK_MODES.find((m) => m.key === s.mode)?.hint}</p>
      </div>

      {s.mode === "block" && (
        <>
          <label>
            <span>Bloquer dès qu&apos;il est banni sur au moins</span>
            <select className="field" value={s.minServers} onChange={(e) => set("minServers", Number(e.target.value))} style={{ maxWidth: 220 }}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} autre{n > 1 ? "s" : ""} serveur{n > 1 ? "s" : ""}</option>)}
            </select>
          </label>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Catégories qui comptent pour le blocage</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {BAN_CATEGORIES.map((c) => (
                <button key={c.key} type="button" className="perm" data-on={s.blockCategories.includes(c.key)} title={c.hint} onClick={() => toggleCategory(c.key)}>{c.label}</button>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>Conseil : au moins 2 serveurs, et seulement les catégories graves. Un seul serveur ne peut pas bannir quelqu&apos;un de tout le réseau.</p>
          </div>
        </>
      )}

      <label className="check" style={{ justifySelf: "start", display: "inline-flex" }}>
        <input type="checkbox" checked={s.listed} onChange={(e) => set("listed", e.target.checked)} />
        Afficher mon serveur dans l&apos;annuaire du réseau
      </label>
      {s.listed && (
        <div className="form-grid">
          <label>
            <span>Présentation (annuaire)</span>
            <input className="field" maxLength={300} value={s.description} onChange={(e) => set("description", e.target.value)} placeholder="Serveur RP whitelist, économie réaliste…" />
          </label>
          <label>
            <span>Invitation Discord</span>
            <input className="field" maxLength={200} value={s.inviteUrl} onChange={(e) => set("inviteUrl", e.target.value.trim())} placeholder="https://discord.gg/…" />
          </label>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn primary" disabled={busy || (s.mode === "block" && s.blockCategories.length === 0)} onClick={save}>
          {member ? <><Save size={14} />Enregistrer</> : <><Network size={14} />Rejoindre le réseau</>}
        </button>
        {member && <button className="btn danger" disabled={busy} onClick={leave}><LogOut size={14} />Quitter le réseau</button>}
      </div>
    </div>
  );
}
