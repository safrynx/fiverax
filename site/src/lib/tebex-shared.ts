import { z } from "zod";

/** Client-safe parts of the Tebex shop: form schemas, labels, money formatting (no DB, no secrets). */

const discordWebhook = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

export const shopAlertsSchema = z.object({
  /** Discord webhook receiving the shop events. */
  webhookUrl: z.string().trim().regex(discordWebhook).nullable().default(null),
  /** Each completed payment. */
  purchases: z.boolean().default(true),
  /** Refunds, chargebacks, disputes, declined payments and ended subscriptions. */
  problems: z.boolean().default(true)
});
export type ShopAlerts = z.infer<typeof shopAlertsSchema>;
export const DEFAULT_SHOP_ALERTS: ShopAlerts = shopAlertsSchema.parse({});

/** Owner settings form. A secret left empty keeps the stored one; `null` removes it. */
export const shopConfigSchema = z.object({
  secret: z.string().trim().regex(/^[\w-]{20,80}$/, "clé secrète Tebex invalide").nullable().optional(),
  publicToken: z.string().trim().regex(/^[a-z0-9-]{4,64}$/i, "token public invalide").nullable().optional(),
  webhookSecret: z.string().trim().min(8).max(128).nullable().optional(),
  alerts: shopAlertsSchema.optional()
});
export type ShopConfigInput = z.infer<typeof shopConfigSchema>;

/** Webhook types, as sent by Tebex, with their label and tone on the panel. */
export const EVENT_TYPES: Record<string, { label: string; tone: "up" | "danger" | "warn" | "info" | "neutral"; problem?: boolean }> = {
  "payment.completed": { label: "Achat", tone: "up" },
  "payment.declined": { label: "Paiement refusé", tone: "neutral", problem: true },
  "payment.refunded": { label: "Remboursement", tone: "warn", problem: true },
  "payment.dispute.opened": { label: "Litige ouvert", tone: "danger", problem: true },
  "payment.dispute.won": { label: "Litige gagné", tone: "up" },
  "payment.dispute.lost": { label: "Litige perdu", tone: "danger", problem: true },
  "payment.dispute.closed": { label: "Litige clos", tone: "neutral" },
  "recurring-payment.started": { label: "Abonnement démarré", tone: "up" },
  "recurring-payment.renewed": { label: "Abonnement renouvelé", tone: "up" },
  "recurring-payment.ended": { label: "Abonnement terminé", tone: "warn", problem: true },
  "recurring-payment.cancellation.requested": { label: "Résiliation demandée", tone: "warn" },
  "recurring-payment.cancellation.aborted": { label: "Résiliation annulée", tone: "info" }
};

export const eventMeta = (type: string) => EVENT_TYPES[type] ?? { label: type, tone: "neutral" as const };

/** Payment statuses of the Plugin API ("Complete", "Refund", "Chargeback"…) in French, with a tone. */
export function paymentStatusMeta(status: string): { label: string; tone: "up" | "danger" | "warn" | "neutral" } {
  const s = status.toLowerCase();
  if (s.startsWith("complete")) return { label: "Payé", tone: "up" };
  if (s.startsWith("refund")) return { label: s.includes("pending") ? "Remboursement en cours" : "Remboursé", tone: "warn" };
  if (s.startsWith("chargeback")) return { label: "Chargeback", tone: "danger" };
  if (s.startsWith("declin")) return { label: "Refusé", tone: "neutral" };
  if (s.includes("pending")) return { label: "En attente", tone: "neutral" };
  return { label: status, tone: "neutral" };
}

/** Pure: 12.5 + "EUR" -> "12,50 €". Unknown currencies fall back to "12,50 XYZ". */
export function formatMoney(amount: number | string | null | undefined, currency: string | null | undefined): string {
  const n = typeof amount === "string" ? Number(amount) : amount ?? 0;
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "EUR" }).format(n);
  } catch {
    return `${n.toFixed(2).replace(".", ",")} ${currency ?? ""}`.trim();
  }
}

/** French message for one of the tebex_* error codes (pages and toasts). */
export function tebexErrorMessage(code: string, message?: string | null): string {
  switch (code) {
    case "tebex_not_configured": return "Boutique non configurée : un propriétaire doit renseigner la clé secrète Tebex (Boutique > Réglages).";
    case "tebex_no_public_token": return "Ajoute le token public de la boutique (Boutique > Réglages) pour afficher le catalogue.";
    case "tebex_bad_secret": return "Tebex refuse la clé secrète (révoquée ou erronée) : vérifie-la dans Boutique > Réglages.";
    case "tebex_not_found": return "Introuvable sur Tebex.";
    case "tebex_rejected": return message ? `Tebex a refusé la demande : ${message}` : "Tebex a refusé la demande (valeurs invalides).";
    case "tebex_rate_limited": return "Trop de requêtes vers Tebex : réessaie dans une minute.";
    case "tebex_unreachable": return "Tebex ne répond pas : réessaie dans un instant.";
    default:
      return code.startsWith("tebex_http_") ? `Tebex a répondu une erreur (code ${code.slice(11)})${message ? ` : ${message}` : "."}` : `Erreur Tebex : ${code}`;
  }
}
