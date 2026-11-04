"use client";
import { useState } from "react";
import CopyButton from "@/app/copy-button";
import { useUI } from "@/app/ui";
import type { ShopAlerts } from "@/lib/tebex-shared";
import { useShopAction } from "../shop-actions";

type Props = {
  hasSecret: boolean;
  secretUnreadable: boolean;
  publicToken: string | null;
  hasWebhookSecret: boolean;
  webhookUrl: string | null;
  alerts: ShopAlerts;
  account: { name: string; domain: string; currency: string; gameType: string; serverName: string } | null;
  checkedAt: string | null;
};

const Section = ({ title, children, intro, className }: { title: string; intro: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={className}>
    <header style={{ paddingBottom: 12, borderBottom: "1px solid var(--line-2)" }}>
      <h2 className="h2">{title}</h2>
      <p className="muted" style={{ margin: "6px 0 0" }}>{intro}</p>
    </header>
    <div style={{ marginTop: 18 }}>{children}</div>
  </section>
);

/** Secret key, public token, webhook (address + secret) and Discord alerts of the Tebex store. */
export default function ShopSettingsForm(props: Props) {
  const { ask } = useUI();
  const { run, busy } = useShopAction();
  const [secret, setSecret] = useState("");
  const [publicToken, setPublicToken] = useState(props.publicToken ?? "");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [alerts, setAlerts] = useState(props.alerts);
  const [hookUrl, setHookUrl] = useState(alerts.webhookUrl ?? "");

  async function saveStore(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = { publicToken: publicToken.trim() || null };
    if (secret.trim()) payload.secret = secret.trim();
    if (await run("config", payload, secret.trim() ? "Clé acceptée par Tebex : boutique reliée" : "Enregistré")) setSecret("");
  }

  async function removeSecret() {
    if (await ask({ title: "Délier la boutique", message: "La clé secrète est supprimée : plus aucune page Boutique ne pourra lire Tebex. Les ventes déjà reçues restent.", confirmLabel: "Délier", danger: true })) {
      await run("config", { secret: null }, "Boutique déliée");
    }
  }

  async function saveWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!webhookSecret.trim()) return;
    if (await run("config", { webhookSecret: webhookSecret.trim() }, "Secret du webhook enregistré")) setWebhookSecret("");
  }

  async function rotate() {
    if (await ask({ title: "Nouvelle adresse de webhook", message: "L'adresse actuelle cessera de fonctionner : il faudra mettre la nouvelle dans Tebex.", confirmLabel: "Changer", danger: true })) {
      await run("webhook_rotate", {}, "Nouvelle adresse créée");
    }
  }

  async function saveAlerts(e: React.FormEvent) {
    e.preventDefault();
    await run("config", { alerts: { ...alerts, webhookUrl: hookUrl.trim() || null } }, "Alertes enregistrées");
  }

  return (
    <div className="cols even" style={{ gap: 56, marginBottom: 56 }}>
      <Section
        className="rise rise-1"
        title="Webstore Tebex"
        intro={<>Clé secrète du serveur de jeu : Tebex &gt; <i>Integrations</i> &gt; <i>Game servers</i> &gt; <i>Edit</i>. C&apos;est la même que <code>tebex:secret</code> dans le <code>server.cfg</code>. Le token public (Tebex &gt; <i>Integrations</i> &gt; <i>Headless API</i>, ou l&apos;identifiant du webstore) sert à lire le catalogue.</>}
      >
        <p style={{ marginTop: 0 }}>
          {props.secretUnreadable
            ? <span className="tag" data-tone="danger">Clé illisible : à ressaisir</span>
            : props.hasSecret ? <span className="tag" data-tone="up">Reliée</span> : <span className="tag" data-tone="warn">Pas de clé</span>}{" "}
          {props.account && <span className="muted" style={{ fontSize: 13 }}>{props.account.name} · {props.account.currency} · {props.account.gameType}{props.account.serverName ? ` · serveur « ${props.account.serverName} »` : ""}</span>}
        </p>
        <form onSubmit={saveStore} className="form-col">
          <label>
            <span>Clé secrète{props.hasSecret ? " (laisser vide pour garder l'actuelle)" : ""}</span>
            <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={props.hasSecret ? "••••••••••••••••" : "ex. 2f6c…"} className="field" />
          </label>
          <label>
            <span>Token public (catalogue)</span>
            <input value={publicToken} onChange={(e) => setPublicToken(e.target.value)} placeholder="ex. t66x-7cd928b1e9399909e6810edac6dc1fd1eefc57cb" className="field" />
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn primary" disabled={busy}>{secret.trim() ? "Vérifier et enregistrer" : "Enregistrer"}</button>
            {props.hasSecret && <button type="button" className="btn" disabled={busy} onClick={() => run("refresh", {}, "Informations du webstore relues")}>Tester la connexion</button>}
            {props.hasSecret && <button type="button" className="linkish" disabled={busy} onClick={removeSecret}>Délier</button>}
          </div>
        </form>
      </Section>

      <Section
        className="rise rise-2"
        title="Webhook (ventes en direct)"
        intro={<>Dans Tebex &gt; <i>Developers</i> &gt; <i>Webhooks</i> &gt; <i>Endpoints</i> : ajoute cette adresse, coche les événements de paiement et d&apos;abonnement, copie le <i>secret</i> ici, puis clique <i>Validate</i>.</>}
      >
        {props.webhookUrl ? (
          <div style={{ display: "grid", gap: 10 }}>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }} className="field">{props.webhookUrl}</pre>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><CopyButton text={props.webhookUrl} label="Copier l'adresse" /><button className="btn" disabled={busy} onClick={rotate}>Changer d&apos;adresse</button></div>
          </div>
        ) : <p className="muted">L&apos;adresse est créée au premier enregistrement du webstore.</p>}
        <form onSubmit={saveWebhook} className="form-col" style={{ marginTop: 16 }}>
          <label>
            <span>Secret du webhook {props.hasWebhookSecret ? "(enregistré : en saisir un autre pour le remplacer)" : "(requis pour accepter les ventes)"}</span>
            <input type="password" autoComplete="off" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} className="field" />
          </label>
          <div><button className="btn primary" disabled={busy || !webhookSecret.trim()}>Enregistrer le secret</button></div>
        </form>
      </Section>

      <Section className="rise rise-3" title="Alertes Discord" intro="Un message dans un salon Discord à chaque vente, et/ou à chaque problème (remboursement, chargeback, litige, paiement refusé, abonnement terminé).">
        <form onSubmit={saveAlerts} className="form-col">
          <label>
            <span>Webhook Discord</span>
            <input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" className="field" />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label className="check" style={{ display: "inline-flex" }}><input type="checkbox" checked={alerts.purchases} onChange={(e) => setAlerts({ ...alerts, purchases: e.target.checked })} />Ventes et renouvellements</label>
            <label className="check" style={{ display: "inline-flex" }}><input type="checkbox" checked={alerts.problems} onChange={(e) => setAlerts({ ...alerts, problems: e.target.checked })} />Problèmes</label>
          </div>
          <div><button className="btn primary" disabled={busy}>Enregistrer les alertes</button></div>
        </form>
      </Section>

      <Section className="rise rise-3" title="Livraison en jeu" intro="Le panel ne livre rien lui-même : la ressource officielle Tebex du serveur FiveM exécute les commandes achetées.">
        <pre className="field" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{`ensure tebex\nset tebex:secret "<clé secrète>"`}</pre>
        <p className="muted" style={{ fontSize: 13 }}>La file d&apos;attente des commandes est visible dans Boutique &gt; Clients. Un joueur est reconnu sur le panel par son compte Cfx.re (identifiant <code>fivem:</code>).</p>
      </Section>
    </div>
  );
}
