"use client";
import { useState } from "react";
import {
  JOIN_RAID_ACTIONS, MESSAGE_ACTIONS, PUNISHMENT_LABELS, PUNISHMENTS, RAID_RULES, RULE_SANCTION_LABELS, RULE_SANCTIONS, YOUNG_ACCOUNT_ACTIONS, type AntiraidSettings
} from "@/lib/security-config";
import { useSecurityAction } from "../security-actions";

const ids = (text: string) => [...new Set(text.split(/[\s,]+/).map((t) => t.trim()).filter((t) => /^\d{17,20}$/.test(t)))];
/** "https://www.YouTube.com/x" -> "youtube.com" style: one domain per line, scheme / path / www. dropped. */
const domains = (text: string) => [...new Set(text.split(/[\s,]+/).map((t) => t.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")).filter((t) => /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(t)))].slice(0, 100);
/** One word or phrase per line. */
const words = (text: string) => [...new Set(text.split("\n").map((t) => t.trim()).filter((t) => t.length >= 2 && t.length <= 60))].slice(0, 200);

type DiscordRole = { id: string; name: string };

/** Pick roles from the guild's list (checkboxes). */
function RolePicker({ roles, value, onChange }: { roles: DiscordRole[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (!roles.length) return <p className="muted" style={{ fontSize: 12 }}>Aucun rôle connu : lance une synchro Discord (page Équipe).</p>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 180, overflow: "auto" }}>
      {roles.map((r) => (
        <button key={r.id} type="button" className="perm" data-on={value.includes(r.id)} onClick={() => onChange(value.includes(r.id) ? value.filter((v) => v !== r.id) : [...value, r.id])}
          style={value.includes(r.id) ? { borderColor: "var(--accent)", color: "var(--text)", background: "rgba(var(--accent-rgb), 0.15)" } : undefined}>
          {r.name}
        </button>
      ))}
    </div>
  );
}

export default function AntiraidSettingsForm({ initial, roles }: { initial: AntiraidSettings; roles: DiscordRole[] }) {
  const { run, busy } = useSecurityAction();
  const [s, setS] = useState(initial);
  const [trusted, setTrusted] = useState(initial.trusted.join("\n"));
  const [protectedChannels, setProtectedChannels] = useState(initial.protectedChannels.join("\n"));
  const [ignoredChannels, setIgnoredChannels] = useState(initial.messages.ignoredChannels.join("\n"));
  const [allowedDomains, setAllowedDomains] = useState(initial.messages.allowedDomains.join("\n"));
  const [bannedWords, setBannedWords] = useState(initial.messages.bannedWords.join("\n"));
  const msg = s.messages;
  const setMsg = (patch: Partial<AntiraidSettings["messages"]>) => setS((prev) => ({ ...prev, messages: { ...prev.messages, ...patch } }));

  const setRule = (key: string, patch: Partial<AntiraidSettings["rules"][keyof AntiraidSettings["rules"]]>) =>
    setS((prev) => ({ ...prev, rules: { ...prev.rules, [key]: { ...prev.rules[key as keyof typeof prev.rules], ...patch } } }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await run("antiraid_config", {
      ...s, trusted: ids(trusted), protectedChannels: ids(protectedChannels),
      messages: { ...s.messages, ignoredChannels: ids(ignoredChannels), allowedDomains: domains(allowedDomains), bannedWords: words(bannedWords) }
    }, "Réglages enregistrés : le bot les applique d'ici une minute");
  }

  return (
    <form onSubmit={save} className="rise rise-2" style={{ display: "grid", gap: 34 }}>
      <div className="banner" style={{ margin: 0 }}>
        <b>Prérequis :</b> le bot doit être <b>Administrateur</b> et son rôle placé <b>tout en haut</b> de la liste des rôles (au-dessus des admins) : il ne peut ni recréer, ni derank au-dessus de lui.
        Le propriétaire du Discord ne peut jamais être sanctionné (règle de Discord), mais ses actions peuvent quand même être annulées s&apos;il n&apos;est pas « de confiance ».
      </div>

      <section>
        <header className="panel-head"><h2 className="h2">Mode</h2><p className="muted">Pas encore sûr de tes réglages ? Commence en observation une semaine : chaque raid apparaît dans les incidents avec ce que le bot aurait fait.</p></header>
        <div className="ac-preset-list" style={{ marginTop: 16 }}>
          {([
            ["protect", "Protection", "Le bot annule les actions destructrices, sanctionne leur auteur, verrouille le serveur pendant un raid et supprime les messages fautifs."],
            ["observe", "Observation", "Le bot détecte et signale tout (panel, salon d'alertes) sans rien annuler ni sanctionner. Un verrouillage manuel reste appliqué."]
          ] as const).map(([mode, label, hint]) => (
            <button key={mode} type="button" className="ac-preset" data-on={s.mode === mode} onClick={() => setS({ ...s, mode })}>
              <b>{label}{s.mode === mode && <span className="tag" data-tone={mode === "protect" ? "up" : "warn"}>choisi</span>}</b>
              <span>{hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <header className="panel-head"><h2 className="h2">Général</h2></header>
        <div style={{ display: "grid", gap: 16, marginTop: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
            <label className="check" style={{ width: "fit-content" }}>
              <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />Anti-raid actif
            </label>
            <label className="check" style={{ width: "fit-content" }}>
              <input type="checkbox" checked={s.trustOwner} onChange={(e) => setS({ ...s, trustOwner: e.target.checked })} />Ignorer les actions du propriétaire du Discord
            </label>
          </div>
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span className="muted" style={{ fontSize: 12 }}>Sanction de l&apos;auteur</span>
            <select className="field" value={s.punishment} onChange={(e) => setS({ ...s, punishment: e.target.value as AntiraidSettings["punishment"] })}>
              {PUNISHMENTS.map((p) => <option key={p} value={p}>{PUNISHMENT_LABELS[p]}</option>)}
            </select>
            <span className="muted" style={{ fontSize: 12 }}>Un bot ajouté qui casse le serveur est toujours expulsé.</span>
            {(s.punishment === "quarantine" || s.youngAccountAction === "quarantine" || Object.values(s.rules).some((r) => r.punishment === "quarantine")) && (
              <select className="field" value={s.quarantineRoleId ?? ""} onChange={(e) => setS({ ...s, quarantineRoleId: e.target.value || null })}>
                <option value="">Rôle de quarantaine…</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
          </label>
          <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Durée du mute (minutes) · sanctions et messages</span>
              <input type="number" min={1} max={40320} className="field" value={s.timeoutMinutes} onChange={(e) => setS({ ...s, timeoutMinutes: Number(e.target.value) })} />
            </label>
            <label className="check" style={{ width: "fit-content" }}>
              <input type="checkbox" checked={s.alertOwnerDm} onChange={(e) => setS({ ...s, alertOwnerDm: e.target.checked })} />Prévenir le propriétaire en MP
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Sauvegarde automatique toutes les (heures, 0 = off)</span>
              <input type="number" min={0} max={168} className="field" value={s.backupEveryHours} onChange={(e) => setS({ ...s, backupEveryHours: Number(e.target.value) })} />
            </label>
          </div>
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span className="muted" style={{ fontSize: 12 }}>Salon d&apos;alerte (ID, facultatif)</span>
            <input className="field" pattern="\d{17,20}" value={s.alertChannelId ?? ""} onChange={(e) => setS({ ...s, alertChannelId: e.target.value.trim() || null })} placeholder="ex. 123456789012345678" />
            <span className="muted" style={{ fontSize: 12 }}>Le bot y poste chaque incident.</span>
          </label>
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span className="muted" style={{ fontSize: 12 }}>Personnes de confiance (IDs Discord, un par ligne)</span>
            <textarea className="field" rows={4} value={trusted} onChange={(e) => setTrusted(e.target.value)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
            <span className="muted" style={{ fontSize: 12 }}>{ids(trusted).length} ID valide(s). Leurs actions ne sont jamais surveillées.</span>
          </label>
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span className="muted" style={{ fontSize: 12 }}>Rôle mentionné à chaque alerte (facultatif)</span>
            <select className="field" value={s.alertRoleId ?? ""} onChange={(e) => setS({ ...s, alertRoleId: e.target.value || null })}>
              <option value="">Aucune mention</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <span className="muted" style={{ fontSize: 12 }}>Ton staff est pingé dans le salon d&apos;alerte dès qu&apos;un incident arrive.</span>
          </label>
        </div>
        <div style={{ display: "grid", gap: 18, marginTop: 18, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <b>Rôles de confiance <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· {s.trustedRoles.length}</span></b>
            <RolePicker roles={roles} value={s.trustedRoles} onChange={(trustedRoles) => setS({ ...s, trustedRoles })} />
            <span className="muted" style={{ fontSize: 12 }}>Les membres qui ont un de ces rôles ne sont jamais surveillés (fondateurs, gérants…). À garder très court.</span>
          </div>
          <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
            <label className="check" style={{ width: "fit-content" }}>
              <input type="checkbox" checked={s.dm.enabled} onChange={(e) => setS({ ...s, dm: { ...s.dm, enabled: e.target.checked } })} />Prévenir la personne sanctionnée en MP
            </label>
            <textarea className="field" rows={3} maxLength={500} disabled={!s.dm.enabled} value={s.dm.message} onChange={(e) => setS({ ...s, dm: { ...s.dm, message: e.target.value } })}
              placeholder="Tu as été sanctionné sur {serveur} par la protection anti-raid ({sanction}) : {raison}." />
            <span className="muted" style={{ fontSize: 12 }}>Envoyé juste avant la sanction. <code>{"{serveur}"}</code>, <code>{"{sanction}"}</code> et <code>{"{raison}"}</code> sont remplacés. Vide : le message par défaut.</span>
          </div>
        </div>
      </section>

      <section>
        <header className="panel-head">
          <h2 className="h2">Rôles et salons protégés</h2>
          <p className="muted">Toucher à l&apos;un d&apos;eux (donner, retirer, modifier, supprimer) est annulé et sanctionné dès la première fois, sauf pour les personnes de confiance.</p>
        </header>
        <div style={{ display: "grid", gap: 18, marginTop: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <b>Rôles protégés <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· {s.protectedRoles.length}</span></b>
            <RolePicker roles={roles} value={s.protectedRoles} onChange={(protectedRoles) => setS({ ...s, protectedRoles })} />
          </div>
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <b>Salons protégés <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· IDs, un par ligne</span></b>
            <textarea className="field" rows={5} value={protectedChannels} onChange={(e) => setProtectedChannels(e.target.value)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
            <span className="muted" style={{ fontSize: 12 }}>{ids(protectedChannels).length} salon(s). Clic droit sur un salon &gt; Copier l&apos;identifiant (mode développeur).</span>
          </label>
        </div>
      </section>

      <section>
        <header className="panel-head">
          <h2 className="h2">Messages</h2>
          <p className="muted">Les messages fautifs sont supprimés ; flood, mentions de masse, liens d&apos;arnaque, comptes piratés et raids de messages donnent aussi un mute. Le staff (Administrateur, Gérer les messages, rôles ignorés) n&apos;est jamais contrôlé.</p>
        </header>
        <div style={{ display: "grid", gap: 14, marginTop: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
            <label className="check" style={{ width: "fit-content" }}><input type="checkbox" checked={msg.enabled} onChange={(e) => setMsg({ enabled: e.target.checked })} />Protection des messages</label>
            <label className="check" style={{ width: "fit-content" }}><input type="checkbox" checked={msg.blockEveryone} onChange={(e) => setMsg({ blockEveryone: e.target.checked })} />Bloquer @everyone / @here</label>
            <label className="check" style={{ width: "fit-content" }}><input type="checkbox" checked={msg.blockInvites} onChange={(e) => setMsg({ blockInvites: e.target.checked })} />Bloquer les invitations Discord *</label>
            <label className="check" style={{ width: "fit-content" }}><input type="checkbox" checked={msg.blockLinks} onChange={(e) => setMsg({ blockLinks: e.target.checked })} />Bloquer tous les liens *</label>
            <label className="check" style={{ width: "fit-content" }}><input type="checkbox" checked={msg.blockScams} onChange={(e) => setMsg({ blockScams: e.target.checked })} />Bloquer les liens d&apos;arnaque (faux Nitro, faux Steam) *</label>
          </div>
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span className="muted" style={{ fontSize: 12 }}>Compte piraté : messages dans au moins … salons (0 = off)</span>
            <input type="number" min={0} max={20} className="field" value={msg.multiChannel} onChange={(e) => setMsg({ multiChannel: Number(e.target.value) })} />
            <span className="muted" style={{ fontSize: 12 }}>en … secondes</span>
            <input type="number" min={3} max={120} className="field" value={msg.multiChannelSeconds} onChange={(e) => setMsg({ multiChannelSeconds: Number(e.target.value) })} />
            <span className="muted" style={{ fontSize: 12 }}>Raid de messages : même message de … comptes en 30 s (0 = off) *</span>
            <input type="number" min={0} max={50} className="field" value={msg.duplicateRaid} onChange={(e) => setMsg({ duplicateRaid: Number(e.target.value) })} />
          </label>
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span className="muted" style={{ fontSize: 12 }}>Flood : plus de … messages</span>
            <input type="number" min={3} max={50} className="field" value={msg.floodCount} onChange={(e) => setMsg({ floodCount: Number(e.target.value) })} />
            <span className="muted" style={{ fontSize: 12 }}>en … secondes</span>
            <input type="number" min={2} max={60} className="field" value={msg.floodSeconds} onChange={(e) => setMsg({ floodSeconds: Number(e.target.value) })} />
            <span className="muted" style={{ fontSize: 12 }}>Mentions max par message</span>
            <input type="number" min={2} max={50} className="field" value={msg.maxMentions} onChange={(e) => setMsg({ maxMentions: Number(e.target.value) })} />
          </label>
          <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span className="muted" style={{ fontSize: 12 }}>Rôles jamais contrôlés</span>
            <RolePicker roles={roles} value={msg.ignoredRoles} onChange={(ignoredRoles) => setMsg({ ignoredRoles })} />
          </div>
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span className="muted" style={{ fontSize: 12 }}>Salons ignorés (IDs, un par ligne)</span>
            <textarea className="field" rows={4} value={ignoredChannels} onChange={(e) => setIgnoredChannels(e.target.value)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
          </label>
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span className="muted" style={{ fontSize: 12 }}>Sanction des fautes graves</span>
            <select className="field" value={msg.action} onChange={(e) => setMsg({ action: e.target.value as AntiraidSettings["messages"]["action"] })}>
              {Object.entries(MESSAGE_ACTIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <span className="muted" style={{ fontSize: 12 }}>Flood, mentions de masse, @everyone, arnaque, compte piraté, raid de messages. Les invitations, liens et mots interdits sont seulement supprimés.</span>
          </label>
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span className="muted" style={{ fontSize: 12 }}>Sites autorisés quand les liens sont bloqués (un par ligne) *</span>
            <textarea className="field" rows={4} value={allowedDomains} onChange={(e) => setAllowedDomains(e.target.value)} placeholder={"youtube.com\ntwitch.tv\nmonserveur.tebex.io"} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
            <span className="muted" style={{ fontSize: 12 }}>{domains(allowedDomains).length} domaine(s). Un domaine autorise aussi ses sous-domaines.</span>
          </label>
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span className="muted" style={{ fontSize: 12 }}>Mots interdits (un mot ou une expression par ligne) *</span>
            <textarea className="field" rows={4} value={bannedWords} onChange={(e) => setBannedWords(e.target.value)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
            <span className="muted" style={{ fontSize: 12 }}>{words(bannedWords).length} mot(s). Mots entiers, sans tenir compte des majuscules ni des accents. Le message est supprimé.</span>
          </label>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>* Le bot doit pouvoir lire le contenu des messages : active « Message Content Intent » dans le portail développeur Discord, puis <code>BOT_MESSAGE_CONTENT=1</code> dans le <code>.env</code> du bot.</p>
      </section>

      <section>
        <header className="panel-head">
          <h2 className="h2">Règles</h2>
          <p className="muted">« Toléré » = nombre d&apos;actions qu&apos;une même personne peut faire dans la fenêtre. Au-delà, le bot annule <b>toutes</b> ses actions de la fenêtre et la sanctionne. 0 = dès la première. Chaque règle peut avoir sa propre sanction, ou seulement être signalée.</p>
        </header>
        <div className="tbl-wrap" style={{ marginTop: 10 }}>
          <table className="tbl" style={{ minWidth: 1020 }}>
            <thead><tr><th>Action surveillée</th><th>Ce que le bot annule</th><th>Annuler</th><th>Sanction</th><th>Toléré</th><th>Fenêtre (s)</th></tr></thead>
            <tbody>
              {RAID_RULES.map((r) => {
                const cur = s.rules[r.key];
                return (
                  <tr key={r.key} style={{ opacity: cur.enabled ? 1 : 0.55 }}>
                    <td>
                      <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
                        <input type="checkbox" checked={cur.enabled} onChange={(e) => setRule(r.key, { enabled: e.target.checked })} style={{ accentColor: "var(--accent)" }} />{r.label}
                      </label>
                    </td>
                    <td className="muted" style={{ fontSize: 12, maxWidth: 260 }}>{r.undo}</td>
                    <td><input type="checkbox" checked={cur.undo} disabled={r.undo.startsWith("Aucun")} onChange={(e) => setRule(r.key, { undo: e.target.checked })} style={{ accentColor: "var(--accent)" }} title="Annuler ce qui a été fait" /></td>
                    <td>
                      <select className="field" style={{ width: 170 }} value={cur.punishment} onChange={(e) => setRule(r.key, { punishment: e.target.value as AntiraidSettings["rules"][typeof r.key]["punishment"] })}>
                        {RULE_SANCTIONS.map((p) => <option key={p} value={p}>{p === "default" ? `Générale (${RULE_SANCTION_LABELS[s.punishment]})` : RULE_SANCTION_LABELS[p]}</option>)}
                      </select>
                    </td>
                    <td><input type="number" min={0} max={100} className="field" style={{ width: 80 }} value={cur.max} onChange={(e) => setRule(r.key, { max: Number(e.target.value) })} /></td>
                    <td><input type="number" min={5} max={3600} className="field" style={{ width: 90 }} value={cur.windowSec} onChange={(e) => setRule(r.key, { windowSec: Number(e.target.value) })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <header className="panel-head"><h2 className="h2">Raid de comptes</h2><p className="muted">Arrivées en masse de comptes (bots, raids organisés).</p></header>
        <div style={{ display: "grid", gap: 14, marginTop: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <label className="check" style={{ alignSelf: "end", width: "fit-content" }}>
            <input type="checkbox" checked={s.joinRaid.enabled} onChange={(e) => setS({ ...s, joinRaid: { ...s.joinRaid, enabled: e.target.checked } })} />Détecter les raids
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Arrivées</span>
            <input type="number" min={3} max={500} className="field" value={s.joinRaid.joins} onChange={(e) => setS({ ...s, joinRaid: { ...s.joinRaid, joins: Number(e.target.value) } })} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>En (secondes)</span>
            <input type="number" min={3} max={600} className="field" value={s.joinRaid.windowSec} onChange={(e) => setS({ ...s, joinRaid: { ...s.joinRaid, windowSec: Number(e.target.value) } })} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Verrouillage (minutes)</span>
            <input type="number" min={1} max={1440} className="field" value={s.joinRaid.lockdownMinutes} onChange={(e) => setS({ ...s, joinRaid: { ...s.joinRaid, lockdownMinutes: Number(e.target.value) } })} />
          </label>
          <label className="check" style={{ alignSelf: "end", width: "fit-content" }}>
            <input type="checkbox" checked={s.joinRaid.smart} onChange={(e) => setS({ ...s, joinRaid: { ...s.joinRaid, smart: e.target.checked } })} />Détection intelligente
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Pendant un raid, les arrivants sont…</span>
            <select className="field" value={s.joinRaid.action} onChange={(e) => setS({ ...s, joinRaid: { ...s.joinRaid, action: e.target.value as AntiraidSettings["joinRaid"]["action"] } })}>
              {Object.entries(JOIN_RAID_ACTIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="check" style={{ alignSelf: "end", width: "fit-content" }}>
            <input type="checkbox" checked={s.joinRaid.lockChannels} onChange={(e) => setS({ ...s, joinRaid: { ...s.joinRaid, lockChannels: e.target.checked } })} />Salons en lecture seule pendant le verrouillage
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Âge minimum du compte (jours, 0 = off)</span>
            <input type="number" min={0} max={365} className="field" value={s.minAccountAgeDays} onChange={(e) => setS({ ...s, minAccountAgeDays: Number(e.target.value) })} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Compte trop récent : action</span>
            <select className="field" value={s.youngAccountAction} disabled={s.minAccountAgeDays === 0} onChange={(e) => setS({ ...s, youngAccountAction: e.target.value as AntiraidSettings["youngAccountAction"] })}>
              {Object.entries(YOUNG_ACCOUNT_ACTIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            {s.youngAccountAction === "quarantine" && !s.quarantineRoleId && <span className="muted" style={{ fontSize: 12, color: "var(--warn)" }}>Choisis un rôle de quarantaine (sanction « Quarantaine » ci-dessus).</span>}
          </label>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>Détection intelligente : une vague plus lente de comptes suspects (créés il y a moins d&apos;une semaine, sans avatar, aux noms semblables) déclenche aussi le verrouillage, dès la moitié du seuil en une minute. Pendant le verrouillage, le niveau de vérification du Discord passe au maximum et chaque nouvel arrivant est expulsé ; tout revient à la normale ensuite.</p>
      </section>

      <div className="save-bar">
        <button className="btn primary" disabled={busy}>Enregistrer les réglages</button>
      </div>
    </form>
  );
}
