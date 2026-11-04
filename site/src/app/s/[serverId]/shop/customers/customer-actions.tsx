"use client";
import { useUI } from "@/app/ui";
import { useShopAction } from "../shop-actions";

/** Ban a player from the webstore (they can no longer buy). Not the in-game ban: that one is in Sécurité > Bans. */
export function StoreBanButton({ user }: { user?: string }) {
  const { ask } = useUI();
  const { run, busy } = useShopAction();
  async function ban() {
    let target = user;
    if (!target) {
      const who = await ask({ title: "Bannir de la boutique", message: "Le joueur ne pourra plus rien acheter sur le webstore. Ce n'est pas un ban en jeu.", confirmLabel: "Suivant", input: { label: "Pseudo ou ID Cfx.re", required: true } });
      if (!who) return;
      target = who.value.trim();
    }
    const reason = await ask({
      title: `Bannir ${target} de la boutique`,
      message: "Le joueur ne pourra plus rien acheter sur le webstore (son jeu n'est pas affecté). Seul le panel Tebex permet de lever ce ban.",
      confirmLabel: "Bannir",
      danger: true,
      input: { label: "Raison", required: true, placeholder: "ex. chargebacks répétés" }
    });
    if (reason) await run("store_ban", { user: target, reason: reason.value.trim() }, `${target} banni de la boutique`);
  }
  return <button className="btn" disabled={busy} onClick={ban}>{user ? "Bannir de la boutique" : "Bannir un joueur"}</button>;
}
