"use client";
import { useState } from "react";
import { useUI } from "@/app/ui";
import { formatMoney } from "@/lib/tebex-shared";
import { parseAmount, useShopAction } from "../shop-actions";

/** Pure: a readable random code ("FVX-7K2Q-M9TD"). */
function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `FVX-${pick()}-${pick()}`;
}

export function CouponForm({ currency }: { currency: string }) {
  const { toast } = useUI();
  const { run, busy } = useShopAction();
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percentage" | "value">("percentage");
  const [amount, setAmount] = useState("10");
  const [effectiveOn, setEffectiveOn] = useState<"cart" | "package" | "category">("cart");
  const [ids, setIds] = useState("");
  const [limit, setLimit] = useState("");
  const [expireDate, setExpireDate] = useState("");
  const [minimum, setMinimum] = useState("");
  const [basketType, setBasketType] = useState<"both" | "single" | "subscription">("both");
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = parseAmount(amount);
    if (value === null) return toast("Réduction invalide.", "error");
    const payload = {
      code: code.trim() || randomCode(),
      discountType,
      amount: value,
      effectiveOn,
      ids: ids.split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0),
      basketType,
      minimum: parseAmount(minimum) ?? 0,
      limit: limit.trim() ? Math.max(1, Math.floor(Number(limit))) || null : null,
      expireDate: expireDate || null,
      username: username.trim(),
      note: note.trim()
    };
    if (await run("coupon_create", payload, `Code ${payload.code} créé`)) {
      setCode("");
      setNote("");
    }
  }

  return (
    <form onSubmit={submit} className="panel rise rise-1" style={{ marginBottom: 24 }}>
      <h2 className="h2" style={{ marginBottom: 14 }}>Nouveau code promo</h2>
      <div className="form-grid">
        <label><span>Code (vide = généré)</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} pattern="[\w\-]{3,40}" placeholder="ex. NOEL25" className="field" /></label>
        <label>
          <span>Réduction</span>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required className="field" style={{ minWidth: 0 }} />
            <select value={discountType} onChange={(e) => setDiscountType(e.target.value as "percentage" | "value")} className="field" style={{ width: 90 }}>
              <option value="percentage">%</option>
              <option value="value">{currency}</option>
            </select>
          </div>
        </label>
        <label>
          <span>S&apos;applique à</span>
          <select value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value as "cart" | "package" | "category")} className="field">
            <option value="cart">Tout le panier</option>
            <option value="package">Des packages</option>
            <option value="category">Des catégories</option>
          </select>
        </label>
        {effectiveOn !== "cart" && <label><span>IDs {effectiveOn === "package" ? "des packages" : "des catégories"}</span><input value={ids} onChange={(e) => setIds(e.target.value)} required placeholder="ex. 5123456, 5123457" className="field" /></label>}
        <label><span>Utilisations max (vide = illimité)</span><input type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} className="field" /></label>
        <label><span>Expire le (vide = jamais)</span><input type="date" value={expireDate} onChange={(e) => setExpireDate(e.target.value)} className="field" /></label>
        <label><span>Panier minimum ({currency})</span><input value={minimum} onChange={(e) => setMinimum(e.target.value)} inputMode="decimal" placeholder="0" className="field" /></label>
        <label>
          <span>Type d&apos;achat</span>
          <select value={basketType} onChange={(e) => setBasketType(e.target.value as "both" | "single" | "subscription")} className="field">
            <option value="both">Achats uniques et abonnements</option>
            <option value="single">Achats uniques</option>
            <option value="subscription">Abonnements</option>
          </select>
        </label>
        <label><span>Réservé à (pseudo, facultatif)</span><input value={username} onChange={(e) => setUsername(e.target.value)} className="field" /></label>
        <label><span>Note interne</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="ex. gagnant de l'event" className="field" /></label>
      </div>
      <div style={{ marginTop: 14 }}><button className="btn primary" disabled={busy}>Créer le code</button></div>
    </form>
  );
}

export function DeleteCouponButton({ id, code }: { id: number; code: string }) {
  const { ask } = useUI();
  const { run, busy } = useShopAction();
  async function remove() {
    if (await ask({ title: `Supprimer ${code}`, message: "Le code ne pourra plus être utilisé.", confirmLabel: "Supprimer", danger: true })) await run("coupon_delete", { id, code }, `Code ${code} supprimé`);
  }
  return <button className="btn" disabled={busy} onClick={remove}>Supprimer</button>;
}

export function GiftCardForm({ currency }: { currency: string }) {
  const { toast, ask } = useUI();
  const { run, busy } = useShopAction();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = parseAmount(amount);
    if (value === null) return toast("Montant invalide.", "error");
    const res = await run("giftcard_create", { amount: value, note: note.trim(), expiresAt: expiresAt || null });
    const card = (res?.data as { data?: { code?: string } } | null)?.data;
    if (card?.code) {
      setAmount("");
      setNote("");
      await ask({ title: "Carte cadeau créée", message: `Code : ${card.code} (${formatMoney(value, currency)}). À transmettre au joueur : il le saisit au paiement sur le webstore.`, confirmLabel: "OK" });
    }
  }

  return (
    <form onSubmit={submit} className="panel rise rise-1">
      <h2 className="h2" style={{ marginBottom: 14 }}>Nouvelle carte cadeau</h2>
      <div className="form-grid">
        <label><span>Montant ({currency})</span><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required placeholder="ex. 20" className="field" /></label>
        <label><span>Expire le (facultatif)</span><input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="field" /></label>
        <label style={{ gridColumn: "1 / -1" }}><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="ex. compensation bug du 12/11" className="field" /></label>
      </div>
      <div style={{ marginTop: 14 }}><button className="btn primary" disabled={busy}>Créer la carte</button></div>
    </form>
  );
}

export function GiftCardLookup() {
  const { run, busy } = useShopAction();
  const [code, setCode] = useState("");
  const [found, setFound] = useState<{ code: string; void: boolean; note: string; balance: { starting: string; remaining: string; currency: string } } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await run("giftcard_lookup", { code: code.trim() }, undefined, { refresh: false });
    setFound((res?.data as { data?: typeof found } | null)?.data ?? null);
  }
  return (
    <form onSubmit={submit} className="panel rise rise-2">
      <h2 className="h2" style={{ marginBottom: 14 }}>Vérifier une carte</h2>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="Code de la carte" className="field" />
        <button className="btn" disabled={busy}>Vérifier</button>
      </div>
      {found && (
        <p style={{ marginBottom: 0 }}>
          <code>{found.code}</code> · solde <b>{formatMoney(found.balance.remaining, found.balance.currency)}</b> sur {formatMoney(found.balance.starting, found.balance.currency)}{" "}
          {found.void && <span className="tag" data-tone="danger">Annulée</span>}
          {found.note && <span className="muted"> · {found.note}</span>}
        </p>
      )}
    </form>
  );
}

export function GiftCardActions({ id, code }: { id: number; code: string }) {
  const { ask, toast } = useUI();
  const { run, busy } = useShopAction();
  async function topUp() {
    const answer = await ask({ title: `Recharger ${code}`, confirmLabel: "Recharger", input: { label: "Montant à ajouter", required: true, placeholder: "ex. 10" } });
    if (!answer) return;
    const amount = parseAmount(answer.value);
    if (amount === null) return toast("Montant invalide.", "error");
    await run("giftcard_topup", { id, amount }, "Carte rechargée");
  }
  async function cancel() {
    if (await ask({ title: `Annuler ${code}`, message: "Le solde restant est perdu et la carte ne peut plus servir.", confirmLabel: "Annuler la carte", danger: true })) await run("giftcard_void", { id }, "Carte annulée");
  }
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <button className="btn" disabled={busy} onClick={topUp}>Recharger</button>
      <button className="btn" disabled={busy} onClick={cancel}>Annuler</button>
    </span>
  );
}
