"use client";
import { useUI } from "@/app/ui";
import { parseAmount, useShopAction } from "../shop-actions";

/** Add a note to a payment (visible in the Tebex panel, signed with the staff name). */
export function NoteButton({ txn }: { txn: string }) {
  const { ask } = useUI();
  const { run, busy } = useShopAction();
  async function add() {
    const answer = await ask({ title: "Ajouter une note", message: "Elle est enregistrée sur le paiement dans Tebex, avec ton pseudo.", confirmLabel: "Ajouter", input: { label: "Note", required: true, multiline: true } });
    if (answer) await run("payment_note", { txn, note: answer.value }, "Note ajoutée");
  }
  return <button className="btn" disabled={busy} onClick={add}>Ajouter une note</button>;
}

const STATUS_TEXT = {
  refund: ["Marquer remboursé", "Tebex retire les packages (commandes d'expiration exécutées). Le remboursement de l'argent lui-même se fait depuis le panel Tebex ou le moyen de paiement."],
  chargeback: ["Marquer chargeback", "Tebex traite le paiement comme contesté par la banque : packages retirés, client signalé."],
  complete: ["Marquer payé", "Le paiement redevient valide : ses packages sont donnés de nouveau."]
} as const;

/** Change the status of a payment on Tebex (refund / chargeback / complete). */
export function StatusButtons({ txn, username, current }: { txn: string; username: string; current: string }) {
  const { ask } = useUI();
  const { run, busy } = useShopAction();
  const now = current.toLowerCase();
  const options = (Object.keys(STATUS_TEXT) as (keyof typeof STATUS_TEXT)[]).filter((s) => !now.startsWith(s));
  async function set(status: keyof typeof STATUS_TEXT) {
    const [label, message] = STATUS_TEXT[status];
    if (await ask({ title: `${label} · ${txn}`, message, confirmLabel: label, danger: status !== "complete" })) {
      await run("payment_status", { txn, status, username }, "Statut changé sur Tebex");
    }
  }
  return <>{options.map((s) => <button key={s} className="btn" disabled={busy} onClick={() => set(s)}>{STATUS_TEXT[s][0]}</button>)}</>;
}

/** Give packages to a player without payment (Tebex creates a manual payment and delivers the commands). */
export function ManualPaymentButton() {
  const { ask, toast } = useUI();
  const { run, busy } = useShopAction();
  async function open() {
    const who = await ask({ title: "Paiement manuel", message: "Donne des packages à un joueur sans qu'il paie : Tebex crée le paiement et livre les commandes comme pour un achat.", confirmLabel: "Suivant", input: { label: "Pseudo du joueur (ou ID Cfx.re)", required: true } });
    if (!who) return;
    const pkgs = await ask({ title: "Packages à donner", message: "Leurs IDs Tebex, séparés par des virgules (visibles dans Boutique > Catalogue).", confirmLabel: "Suivant", input: { label: "IDs des packages", required: true, placeholder: "ex. 5123456, 5123457" } });
    if (!pkgs) return;
    const packageIds = [...new Set(pkgs.value.split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!packageIds.length) return toast("Aucun ID de package valide.", "error");
    const extra = await ask({ title: "Prix et note", message: "Prix enregistré pour le paiement (0 pour un cadeau), puis la raison après une barre « | ».", confirmLabel: "Créer le paiement", input: { label: "Prix | raison", initial: "0 | ", placeholder: "0 | gagnant de l'event" } });
    if (!extra) return;
    const [rawPrice, ...rest] = extra.value.split("|");
    const price = rawPrice.trim() === "0" || !rawPrice.trim() ? 0 : parseAmount(rawPrice);
    if (price === null) return toast("Prix invalide.", "error");
    await run("payment_create", { username: who.value.trim(), packageIds, price, note: rest.join("|").trim() }, `Paiement manuel créé pour ${who.value.trim()}`);
  }
  return <button className="btn primary" disabled={busy} onClick={open}>Paiement manuel</button>;
}
