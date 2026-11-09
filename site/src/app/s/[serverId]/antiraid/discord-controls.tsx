"use client";
import { DatabaseBackup, Lock, LockOpen, ScanSearch } from "lucide-react";
import { useUI } from "@/app/ui";
import { useSecurityAction } from "../security-actions";

/** Emergency buttons: lock / unlock the Discord, back it up now. The bot runs them within ~15 s. */
export default function DiscordControls({ disabled }: { disabled: boolean }) {
  const { ask } = useUI();
  const { run, busy } = useSecurityAction();

  async function lockdown() {
    const answer = await ask({
      title: "Verrouiller le Discord",
      message: "Vérification au maximum et chaque nouvel arrivant expulsé. Ajoute « fermer » pour aussi passer tous les salons textuels en lecture seule pour @everyone (rouverts à la fin).",
      confirmLabel: "Verrouiller",
      danger: true,
      input: { label: "Durée en minutes (et « fermer » si besoin)", required: true, initial: "30" }
    });
    if (!answer) return;
    const minutes = Math.min(1440, Math.max(1, parseInt(answer.value, 10) || 30));
    await run("discord_lockdown", { minutes, lockChannels: /fermer|salon/i.test(answer.value) }, `Verrouillage demandé (${minutes} min) : le bot l'applique d'ici 15 s`);
  }

  async function unlock() {
    if (await ask({ title: "Déverrouiller le Discord", message: "Vérification et salons remis comme avant le verrouillage.", confirmLabel: "Déverrouiller" })) {
      await run("discord_unlock", {}, "Déverrouillage demandé");
    }
  }

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <button className="btn danger" disabled={busy || disabled} onClick={lockdown}><Lock size={15} />Verrouiller</button>
      <button className="btn" disabled={busy || disabled} onClick={unlock}><LockOpen size={15} />Déverrouiller</button>
      <button className="btn" disabled={busy || disabled} onClick={() => run("discord_backup", {}, "Sauvegarde demandée : elle apparaît dans l'onglet Sauvegardes")}><DatabaseBackup size={15} />Sauvegarder</button>
    </div>
  );
}

/** Restore one backup (recreates what is missing, never deletes). */
export function RestoreBackupButton({ id, disabled }: { id: number; disabled: boolean }) {
  const { ask } = useUI();
  const { run, busy } = useSecurityAction();
  async function restore() {
    const ok = await ask({
      title: `Restaurer la sauvegarde #${id}`,
      message: "Le bot recrée les rôles et salons manquants (avec leurs permissions) et redonne les rôles recréés à leurs membres. Rien n'est supprimé.",
      confirmLabel: "Restaurer",
      danger: true
    });
    if (ok) await run("discord_restore", { backupId: id }, "Restauration demandée : suis-la dans les incidents");
  }
  return <button className="btn" disabled={busy || disabled} onClick={restore}>Restaurer</button>;
}

/** Ask the bot for a security audit of the Discord (permissions, bots, @everyone, 2FA…), back within ~15 s. */
export function DiscordAuditButton({ disabled, again }: { disabled: boolean; again: boolean }) {
  const { run, busy } = useSecurityAction();
  return (
    <button className="btn primary" disabled={busy || disabled} onClick={() => run("discord_audit", {}, "Audit demandé : le résultat arrive d'ici 15 à 30 s (actualise la page)")}>
      <ScanSearch size={15} />{again ? "Relancer l'audit" : "Lancer l'audit"}
    </button>
  );
}
