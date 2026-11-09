"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlatformSettings } from "@/lib/platform-shared";
import { describeApiError, useUI } from "@/app/ui";

/** The platform settings (/admin/settings). One save for everything; the change reaches every instance within ~10 s. */
export default function SettingsForm({ initial, envMaxServers }: { initial: PlatformSettings; envMaxServers: number }) {
  const router = useRouter();
  const { ask, toast } = useUI();
  const [s, setS] = useState<PlatformSettings>(initial);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  const set = <K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const num = (raw: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(raw) || 0)));

  async function save() {
    if (!s.beta.active && initial.beta.active) {
      const ok = await ask({ title: "Ouvrir Fiverax à tout le monde", message: "Fin de la bêta privée : n'importe quel compte pourra ajouter son serveur, et tous les serveurs existants s'ouvrent.", confirmLabel: "Ouvrir à tous" });
      if (!ok) return;
    }
    if (s.maintenance.active && !initial.maintenance.active) {
      const ok = await ask({ title: "Activer la maintenance", message: "Le panel se ferme à tous les comptes sauf aux administrateurs. Le bot, les agents FiveM et les pages publiques continuent.", confirmLabel: "Activer", danger: true });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin?action=settings_save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: s }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast(describeApiError(data, res.status), "error");
      toast("Réglages enregistrés.", "ok");
      router.refresh();
    } catch {
      toast("Impossible de joindre le panel.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="adm-form rise rise-1" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <fieldset>
        <legend>Bêta privée</legend>
        <label className="adm-toggle">
          <input type="checkbox" checked={s.beta.active} onChange={(e) => set("beta", { ...s.beta, active: e.target.checked })} />
          <span>Bêta privée active<small className="muted" style={{ display: "block" }}>Seuls les partenaires (Administration &gt; Bêta & partenaires) ajoutent un serveur, et seuls leurs serveurs s&apos;ouvrent. Les autres comptes peuvent demander l&apos;accès. Décoché : ouvert à tous.</small></span>
        </label>
        <div className="adm-row">
          <label htmlFor="beta-msg">Message affiché aux comptes non partenaires</label>
          <textarea id="beta-msg" className="field" rows={2} maxLength={400} value={s.beta.message} onChange={(e) => set("beta", { ...s.beta, message: e.target.value })}
            placeholder="Fiverax ouvre d'abord à un petit groupe de serveurs partenaires…" />
          <small>Vide : le texte par défaut.</small>
        </div>
      </fieldset>

      <fieldset>
        <legend>Inscriptions</legend>
        <label className="adm-toggle">
          <input type="checkbox" checked={s.registrationsOpen} onChange={(e) => set("registrationsOpen", e.target.checked)} />
          <span>Tout le monde peut ajouter un serveur<small className="muted" style={{ display: "block" }}>Décoché : seuls les administrateurs en ajoutent (les serveurs existants ne changent pas).</small></span>
        </label>
        <div className="adm-row">
          <label htmlFor="max-servers">Serveurs par compte</label>
          <input id="max-servers" className="field" type="number" min={0} max={100} placeholder={String(envMaxServers)} style={{ maxWidth: 220 }}
            value={s.maxServersPerUser ?? ""} onChange={(e) => set("maxServersPerUser", e.target.value === "" ? null : num(e.target.value, 100))} />
          <small>Vide : la valeur de l&apos;environnement, MAX_SERVERS_PER_USER ({envMaxServers}).</small>
        </div>
        <label className="adm-toggle">
          <input type="checkbox" checked={s.publicScanEnabled} onChange={(e) => set("publicScanEnabled", e.target.checked)} />
          <span>Scan gratuit ouvert (/scan)</span>
        </label>
      </fieldset>

      <fieldset>
        <legend>Annonce</legend>
        <label className="adm-toggle">
          <input type="checkbox" checked={s.announcement.active} onChange={(e) => set("announcement", { ...s.announcement, active: e.target.checked })} />
          <span>Afficher un message en haut de toutes les pages du panel</span>
        </label>
        <div className="adm-row">
          <label htmlFor="ann-text">Message</label>
          <textarea id="ann-text" className="field" rows={2} maxLength={300} value={s.announcement.text} onChange={(e) => set("announcement", { ...s.announcement, text: e.target.value })}
            placeholder="Nouvelle version : le Studio IA sait maintenant…" />
        </div>
        <div className="adm-row">
          <label htmlFor="ann-tone">Ton</label>
          <select id="ann-tone" className="field" style={{ maxWidth: 220 }} value={s.announcement.tone} onChange={(e) => set("announcement", { ...s.announcement, tone: e.target.value as PlatformSettings["announcement"]["tone"] })}>
            <option value="info">Information</option>
            <option value="warn">Attention</option>
            <option value="danger">Important</option>
          </select>
        </div>
      </fieldset>

      <fieldset>
        <legend>Maintenance</legend>
        <label className="adm-toggle">
          <input type="checkbox" checked={s.maintenance.active} onChange={(e) => set("maintenance", { ...s.maintenance, active: e.target.checked })} />
          <span>Panel en maintenance<small className="muted" style={{ display: "block" }}>Seuls les administrateurs entrent. Bot, agents FiveM, annuaire, portails et boutiques continuent de fonctionner.</small></span>
        </label>
        <div className="adm-row">
          <label htmlFor="mt-msg">Message affiché</label>
          <textarea id="mt-msg" className="field" rows={2} maxLength={300} value={s.maintenance.message} onChange={(e) => set("maintenance", { ...s.maintenance, message: e.target.value })}
            placeholder="Mise à jour en cours, retour vers 22 h." />
        </div>
      </fieldset>

      <fieldset>
        <legend>IA</legend>
        <label className="adm-toggle">
          <input type="checkbox" checked={s.ai.enabled} onChange={(e) => set("ai", { ...s.ai, enabled: e.target.checked })} />
          <span>IA activée<small className="muted" style={{ display: "block" }}>Studio, assistant, Store Creator, plans, explications, bilans et analyse des captures. Décoché : tout est coupé tout de suite.</small></span>
        </label>
        <div className="adm-nums" style={{ marginTop: 6 }}>
          <div className="adm-row">
            <label htmlFor="ai-server">Appels / serveur / jour</label>
            <input id="ai-server" className="field" type="number" min={0} max={100000} value={s.ai.perServerDaily} onChange={(e) => set("ai", { ...s.ai, perServerDaily: num(e.target.value, 100_000) })} />
          </div>
          <div className="adm-row">
            <label htmlFor="ai-user">Appels / compte / jour</label>
            <input id="ai-user" className="field" type="number" min={0} max={100000} value={s.ai.perUserDaily} onChange={(e) => set("ai", { ...s.ai, perUserDaily: num(e.target.value, 100_000) })} />
          </div>
          <div className="adm-row">
            <label htmlFor="ai-global">Appels / jour (toute la plateforme)</label>
            <input id="ai-global" className="field" type="number" min={0} max={1000000} value={s.ai.globalDaily} onChange={(e) => set("ai", { ...s.ai, globalDaily: num(e.target.value, 1_000_000) })} />
          </div>
        </div>
        <small className="muted" style={{ display: "block", marginTop: 8 }}>0 = pas de limite. Les jours sont comptés en UTC. Une fois un quota atteint, l&apos;IA répond « quota atteint » jusqu&apos;au lendemain.</small>
      </fieldset>

      <div className="adm-actions">
        <button className="btn primary" disabled={busy || !dirty}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
        {dirty && <button type="button" className="linkish" onClick={() => setS(initial)}>Annuler les changements</button>}
      </div>
    </form>
  );
}
