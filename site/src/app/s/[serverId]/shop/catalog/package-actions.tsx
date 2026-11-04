"use client";
import { useUI } from "@/app/ui";
import { parseAmount, useShopAction } from "../shop-actions";

type Props = { id: number; name: string; price: number; disabled: boolean; currency: string };

/** Rename / re-price, take off sale or put back, and make a direct purchase link for a player. */
export function PackageActions({ id, name, price, disabled, currency }: Props) {
  const { ask, toast } = useUI();
  const { run, busy } = useShopAction();

  async function edit() {
    const n = await ask({ title: `Modifier « ${name} »`, confirmLabel: "Suivant", input: { label: "Nom", required: true, initial: name } });
    if (!n) return;
    const p = await ask({ title: "Prix", message: `En ${currency}, hors taxes (prix de base Tebex).`, confirmLabel: "Enregistrer", input: { label: "Prix", required: true, initial: String(price) } });
    if (!p) return;
    const amount = p.value.trim() === "0" ? 0 : parseAmount(p.value);
    if (amount === null) return toast("Prix invalide.", "error");
    await run("package_update", { id, name: n.value.trim(), price: amount, disabled }, "Package modifié sur Tebex");
  }

  async function toggle() {
    const label = disabled ? "Remettre en vente" : "Retirer de la vente";
    const message = disabled ? "Le package réapparaît sur le webstore." : "Le package disparaît du webstore (ses achats passés ne changent pas). Tu pourras le remettre en vente depuis cette page.";
    if (await ask({ title: `${label} · ${name}`, message, confirmLabel: label, danger: !disabled })) {
      await run("package_update", { id, name, price, disabled: !disabled }, disabled ? "Package remis en vente" : "Package retiré de la vente");
    }
  }

  async function checkout() {
    const who = await ask({ title: `Lien d'achat · ${name}`, message: "Un lien à envoyer au joueur : il arrive sur le webstore avec ce package dans son panier.", confirmLabel: "Créer le lien", input: { label: "Pseudo du joueur (ou ID Cfx.re)", required: true } });
    if (!who) return;
    const res = await run("checkout", { packageId: id, username: who.value.trim() }, undefined, { refresh: false });
    const url = (res?.data as { url?: string } | null)?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast("Lien d'achat copié dans le presse-papiers", "ok");
    } catch {
      await ask({ title: "Lien d'achat", message: url, confirmLabel: "Fermer" });
    }
  }

  return (
    <div className="shop-card-actions">
      {!disabled && <button className="btn" disabled={busy} onClick={edit}>Modifier</button>}
      <button className="btn" disabled={busy} onClick={toggle}>{disabled ? "Remettre en vente" : "Retirer"}</button>
      {!disabled && <button className="btn" disabled={busy} onClick={checkout}>Lien d&apos;achat</button>}
    </div>
  );
}
