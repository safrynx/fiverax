"use client";
import { useState } from "react";
import { Gauge, ListPlus, ScanSearch } from "lucide-react";
import {
  AC_ACTION_LABELS, AC_ACTIONS, AC_PRESETS, anticheatStrength, applyPreset, DETECTIONS, presetOf, RECOMMENDED_HONEYPOTS, RECOMMENDED_TARGETED,
  type AcAction, type AcPreset, type AnticheatSettings
} from "@/lib/security-config";
import { scoreTier } from "@/app/score-ring";
import { useSecurityAction } from "../security-actions";

const lines = (text: string) => text.split(/[\n,]/).map((l) => l.trim()).filter(Boolean);

const LIMITS: [keyof AnticheatSettings["limits"], string, string][] = [
  ["eventsPer10s", "Événements protégés", "appels / 10 s par joueur"],
  ["entitiesPer10s", "Entités créées", "par joueur / 10 s"],
  ["explosionsPer10s", "Explosions", "par joueur / 10 s"],
  ["ptfxPer10s", "Particules", "par joueur / 10 s"],
  ["projectilesPer10s", "Projectiles", "par joueur / 10 s"],
  ["footSpeed", "Vitesse max à pied", "m/s"],
  ["teleportDistance", "Saut de téléportation", "mètres en 2 s"],
  ["damageDistance", "Distance de tir max", "mètres"],
  ["damagePer10s", "Coups infligés", "par joueur / 10 s"],
  ["killsPer10s", "Joueurs tués", "par joueur / 10 s"],
  ["noclipDistance", "Distance du noclip", "mètres en 2 s sans vitesse réelle"],
  ["vehicleSpeed", "Vitesse max des véhicules", "m/s, 125 = 450 km/h"]
];

/** "event, 15" per line ⇄ [{ event, maxDistance }] */
const targetedText = (list: AnticheatSettings["targetedEvents"]) => list.map((t) => `${t.event}, ${t.maxDistance}`).join("\n");
const parseTargeted = (text: string): AnticheatSettings["targetedEvents"] =>
  text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(.+?)[\s,;]+(\d+(?:\.\d+)?)$/.exec(l);
    return { event: (m ? m[1] : l).trim().slice(0, 100), maxDistance: Math.min(1000, Math.max(2, m ? Number(m[2]) : 15)) };
  }).slice(0, 100);

const LISTS: [keyof Pick<AnticheatSettings, "honeypotEvents" | "protectedEvents" | "blacklistedWeapons" | "blacklistedModels" | "blacklistedPeds">, string, string][] = [
  ["honeypotEvents", "Événements pièges", "Déclencher l'un d'eux = détection « Événement piège ». Ignoré si une ressource du même nom tourne (esx_truckerjob:pay quand esx_truckerjob est démarrée)."],
  ["protectedEvents", "Événements protégés (anti-spam)", "Tes événements sensibles (paie, inventaire…) : au-delà de la limite par 10 s, détection « Spam d'événements »."],
  ["blacklistedWeapons", "Armes interdites", "Noms GTA (WEAPON_RAILGUN…)."],
  ["blacklistedModels", "Véhicules et objets interdits", "Noms de modèles (hydra, prop_windmill_01…). Leur création est bloquée."],
  ["blacklistedPeds", "Skins interdits", "Modèles de ped (a_c_chimp…)."]
];

const groups = [...new Set(DETECTIONS.map((d) => d.group))];

export default function AnticheatSettingsForm({ initial, scannerEvents = [] }: { initial: AnticheatSettings; scannerEvents?: string[] }) {
  const { run, busy } = useSecurityAction();
  const [s, setS] = useState(initial);
  const [texts, setTexts] = useState(() => Object.fromEntries(LISTS.map(([k]) => [k, initial[k].join("\n")])) as Record<(typeof LISTS)[number][0], string>);
  const [targeted, setTargeted] = useState(() => targetedText(initial.targetedEvents));
  const [explosions, setExplosions] = useState(initial.blockedExplosions.join(", "));
  const [blockedNames, setBlockedNames] = useState(initial.connection.blockedNames.join("\n"));
  const [whitelist, setWhitelist] = useState(initial.connection.whitelist.join("\n"));
  const conn = s.connection;
  const setConn = (patch: Partial<AnticheatSettings["connection"]>) => setS((prev) => ({ ...prev, connection: { ...prev.connection, ...patch } }));

  const setDetection = (key: string, patch: Partial<{ action: AcAction; screenshot: boolean }>) =>
    setS((prev) => ({ ...prev, detections: { ...prev.detections, [key]: { ...prev.detections[key as keyof typeof prev.detections], ...patch } } }));

  /** The settings as they would be saved (lists read from their text fields). */
  const current = (): AnticheatSettings => ({
    ...s,
    ...Object.fromEntries(LISTS.map(([k]) => [k, lines(texts[k])])),
    targetedEvents: parseTargeted(targeted),
    alerts: { ...s.alerts, webhookUrl: s.alerts.webhookUrl?.trim() || null }
  });
  const strength = anticheatStrength(current());
  const preset = presetOf(s);
  const missingHoneypots = RECOMMENDED_HONEYPOTS.filter((h) => !lines(texts.honeypotEvents).includes(h));
  const knownTargeted = new Set(parseTargeted(targeted).map((t) => t.event));
  const missingTargeted = RECOMMENDED_TARGETED.filter((t) => !knownTargeted.has(t.event));
  const newScannerEvents = scannerEvents.filter((ev) => !lines(texts.protectedEvents).includes(ev));
  const addLines = (key: (typeof LISTS)[number][0], extra: readonly string[]) => setTexts((t) => ({ ...t, [key]: [...lines(t[key]), ...extra].join("\n") }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const value: AnticheatSettings = {
      ...current(),
      blockedExplosions: lines(explosions).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 100),
      connection: { ...s.connection, blockedNames: lines(blockedNames), whitelist: lines(whitelist).filter((id) => /^[a-z0-9]+:[\w.-]+$/i.test(id)) }
    };
    await run("anticheat_config", value, "Réglages enregistrés : l'agent les applique à son prochain appel");
  }

  return (
    <form onSubmit={save} className="rise rise-2" style={{ display: "grid", gap: 34 }}>
      <section className="ac-presets">
        <div className="ac-strength" style={{ ["--tier" as string]: scoreTier(strength)[1] }}>
          <Gauge size={18} />
          <div>
            <div className="eyebrow">Couverture des menaces</div>
            <b>{strength}<small>/100</small></b>
          </div>
          <div className="ac-strength-bar"><i style={{ width: `${strength}%` }} /></div>
          <p className="muted">Détections pondérées par leur gravité, cumul, alertes et pièges. Recalculé à chaque changement.</p>
        </div>
        <div className="ac-preset-list">
          {AC_PRESETS.map((p) => (
            <button key={p.key} type="button" className="ac-preset" data-on={preset === p.key} onClick={() => setS((prev) => applyPreset(prev, p.key as AcPreset))}>
              <b>{p.label}{preset === p.key && <span className="tag" data-tone="up">actif</span>}</b>
              <span>{p.hint}</span>
            </button>
          ))}
          {preset === "custom" && <p className="muted" style={{ margin: 0, fontSize: 12, gridColumn: "1 / -1" }}>Réglages personnalisés. Choisir un préréglage remplace la sanction de chaque détection (captures, listes et limites gardées) ; rien n&apos;est appliqué avant « Enregistrer ».</p>}
        </div>
      </section>

      <section>
        <header className="panel-head"><h2 className="h2">Général</h2></header>
        <div style={{ display: "grid", gap: 14, marginTop: 16, maxWidth: 720 }}>
          <label className="check" style={{ width: "fit-content" }}>
            <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />Anticheat actif
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Message affiché au joueur banni</span>
            <input className="field" maxLength={300} required value={s.banMessage} onChange={(e) => setS({ ...s, banMessage: e.target.value })} />
          </label>
          <label style={{ display: "grid", gap: 6, maxWidth: 260 }}>
            <span className="muted" style={{ fontSize: 12 }}>Durée des bans de l&apos;anticheat (heures, 0 = définitif)</span>
            <input type="number" min={0} max={87600} className="field" value={s.banHours} onChange={(e) => setS({ ...s, banHours: Number(e.target.value) })} />
          </label>
        </div>
      </section>

      <section>
        <header className="panel-head">
          <h2 className="h2">Connexions</h2>
          <p className="muted">Vérifié par l&apos;agent quand un joueur se connecte (avant le chargement). Les identifiants de la liste blanche passent toujours et ne sont jamais contrôlés par l&apos;anticheat.</p>
        </header>
        <div style={{ display: "grid", gap: 16, marginTop: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
            <label className="check" style={{ width: "fit-content" }}>
              <input type="checkbox" checked={conn.locked} onChange={(e) => setConn({ locked: e.target.checked })} />Serveur verrouillé (liste blanche seulement)
            </label>
            {conn.locked && <input className="field" maxLength={300} value={conn.lockMessage} onChange={(e) => setConn({ lockMessage: e.target.value })} placeholder="Message affiché" />}
            <label className="check" style={{ width: "fit-content" }}>
              <input type="checkbox" checked={conn.requireDiscord} onChange={(e) => setConn({ requireDiscord: e.target.checked })} />Compte Discord obligatoire
            </label>
            <label className="check" style={{ width: "fit-content" }}>
              <input type="checkbox" checked={conn.requireSteam} onChange={(e) => setConn({ requireSteam: e.target.checked })} />Steam obligatoire
            </label>
            <label style={{ display: "grid", gap: 6, maxWidth: 220 }}>
              <span className="muted" style={{ fontSize: 12 }}>Longueur minimale du pseudo (0 = libre)</span>
              <input type="number" min={0} max={20} className="field" value={conn.minNameLength} onChange={(e) => setConn({ minNameLength: Number(e.target.value) })} />
            </label>
          </div>
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span><b>Pseudos interdits</b> <span className="muted" style={{ fontSize: 12 }}>· un mot par ligne (contenu dans le pseudo, sans casse)</span></span>
            <textarea className="field" rows={6} value={blockedNames} onChange={(e) => setBlockedNames(e.target.value)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
          </label>
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span><b>Liste blanche</b> <span className="muted" style={{ fontSize: 12 }}>· identifiants complets (license:…, discord:…, steam:…)</span></span>
            <textarea className="field" rows={6} value={whitelist} onChange={(e) => setWhitelist(e.target.value)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} placeholder="discord:123456789012345678" />
          </label>
        </div>
      </section>

      <section>
        <header className="panel-head">
          <h2 className="h2">Cumul de détections</h2>
          <p className="muted">Les petites détections (« Signaler ») s&apos;additionnent par joueur : au seuil, kick puis ban automatique. Les faux positifs marqués ne comptent pas.</p>
        </header>
        <div style={{ display: "grid", gap: 14, marginTop: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <label className="check" style={{ alignSelf: "end", width: "fit-content" }}>
            <input type="checkbox" checked={s.strikes.enabled} onChange={(e) => setS({ ...s, strikes: { ...s.strikes, enabled: e.target.checked } })} />Activer le cumul
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Sur les dernières (heures)</span>
            <input type="number" min={1} max={720} className="field" value={s.strikes.windowHours} onChange={(e) => setS({ ...s, strikes: { ...s.strikes, windowHours: Number(e.target.value) } })} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Kick à (détections, 0 = jamais)</span>
            <input type="number" min={0} max={100} className="field" value={s.strikes.kickAt} onChange={(e) => setS({ ...s, strikes: { ...s.strikes, kickAt: Number(e.target.value) } })} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Ban à (détections, 0 = jamais)</span>
            <input type="number" min={0} max={100} className="field" value={s.strikes.banAt} onChange={(e) => setS({ ...s, strikes: { ...s.strikes, banAt: Number(e.target.value) } })} />
          </label>
        </div>
      </section>

      <section>
        <header className="panel-head"><h2 className="h2">Alertes Discord</h2><p className="muted">Un webhook de ton salon staff (Paramètres du salon &gt; Intégrations &gt; Webhooks) reçoit les détections en direct.</p></header>
        <div style={{ display: "grid", gap: 14, marginTop: 16, gridTemplateColumns: "2fr 1fr", maxWidth: 900 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>URL du webhook</span>
            <input className="field" value={s.alerts.webhookUrl ?? ""} onChange={(e) => setS({ ...s, alerts: { ...s.alerts, webhookUrl: e.target.value || null } })} placeholder="https://discord.com/api/webhooks/…" />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Envoyer à partir de</span>
            <select className="field" value={s.alerts.minAction} onChange={(e) => setS({ ...s, alerts: { ...s.alerts, minAction: e.target.value as AnticheatSettings["alerts"]["minAction"] } })}>
              <option value="log">Toutes les détections</option>
              <option value="kick">Kicks et bans</option>
              <option value="ban">Bans seulement</option>
            </select>
          </label>
          <label className="check" style={{ width: "fit-content" }}>
            <input type="checkbox" checked={s.alerts.aiCheat} onChange={(e) => setS({ ...s, alerts: { ...s.alerts, aiCheat: e.target.checked } })} />Toujours alerter quand l&apos;IA voit un cheat
          </label>
        </div>
      </section>

      <section>
        <header className="panel-head">
          <h2 className="h2">Détections</h2>
          <p className="muted">Sanction de chaque détection. « Signaler » enregistre sans sanctionner : idéal pour vérifier les faux positifs avant de passer en kick ou ban. La capture est analysée par l&apos;IA.</p>
        </header>
        {groups.map((group) => (
          <div key={group} style={{ marginTop: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>{group}</div>
            <div className="tbl-wrap">
              <table className="tbl" style={{ minWidth: 720 }}>
                <tbody>
                  {DETECTIONS.filter((d) => d.group === group).map((d) => {
                    const cur = s.detections[d.key];
                    return (
                      <tr key={d.key}>
                        <td style={{ width: "48%" }}><b>{d.label}</b><div className="muted" style={{ fontSize: 12 }}>{d.hint}</div></td>
                        <td>
                          <select className="field" value={cur.action} onChange={(e) => setDetection(d.key, { action: e.target.value as AcAction })} style={{ width: 150 }}>
                            {AC_ACTIONS.map((a) => <option key={a} value={a}>{AC_ACTION_LABELS[a]}</option>)}
                          </select>
                        </td>
                        <td>
                          {d.key !== "ai_screenshot" && (
                            <label className="check" style={{ padding: "6px 10px" }}>
                              <input type="checkbox" checked={cur.screenshot} disabled={cur.action === "off"} onChange={(e) => setDetection(d.key, { screenshot: e.target.checked })} />Capture
                            </label>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      <section>
        <header className="panel-head"><h2 className="h2">Analyse IA des captures</h2><p className="muted">Nécessite <code>screenshot-basic</code> sur le serveur FiveM et une clé IA sur le site.</p></header>
        <div style={{ display: "grid", gap: 14, marginTop: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", maxWidth: 900 }}>
          <label className="check" style={{ alignSelf: "end", width: "fit-content" }}>
            <input type="checkbox" checked={s.ai.enabled} onChange={(e) => setS({ ...s, ai: { ...s.ai, enabled: e.target.checked } })} />Analyser chaque capture
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Capture d&apos;un joueur au hasard toutes les… (min, 0 = jamais)</span>
            <input type="number" min={0} max={1440} className="field" value={s.ai.randomEveryMinutes} onChange={(e) => setS({ ...s, ai: { ...s.ai, randomEveryMinutes: Number(e.target.value) } })} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Ban auto si l&apos;IA est sûre à… % (0 = jamais)</span>
            <input type="number" min={0} max={100} className="field" value={s.ai.autoBanScore} onChange={(e) => setS({ ...s, ai: { ...s.ai, autoBanScore: Number(e.target.value) } })} />
          </label>
        </div>
        {s.ai.autoBanScore > 0 && s.ai.autoBanScore < 90 && <div className="banner" style={{ marginTop: 14 }}>Un seuil sous 90 % risque de bannir des joueurs innocents : l&apos;IA peut se tromper sur un HUD ou un menu de ton serveur.</div>}
      </section>

      <section>
        <header className="panel-head"><h2 className="h2">Limites</h2></header>
        <div style={{ display: "grid", gap: 14, marginTop: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {LIMITS.map(([key, label, unit]) => (
            <label key={key} style={{ display: "grid", gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>{label} <span style={{ opacity: 0.7 }}>({unit})</span></span>
              <input type="number" className="field" value={s.limits[key]} onChange={(e) => setS({ ...s, limits: { ...s.limits, [key]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
      </section>

      <section>
        <header className="panel-head"><h2 className="h2">Listes</h2><p className="muted">Un élément par ligne.</p></header>
        <div style={{ display: "grid", gap: 18, marginTop: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {LISTS.map(([key, label, hint]) => (
            <div key={key} style={{ display: "grid", gap: 6, alignContent: "start" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span><b>{label}</b> <span className="muted" style={{ fontSize: 12 }}>· {lines(texts[key]).length}</span></span>
                <span className="muted" style={{ fontSize: 12 }}>{hint}</span>
                <textarea className="field" rows={7} value={texts[key]} onChange={(e) => setTexts({ ...texts, [key]: e.target.value })} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
              </label>
              {key === "honeypotEvents" && missingHoneypots.length > 0 && (
                <button type="button" className="btn sm" style={{ justifySelf: "start" }} onClick={() => addLines("honeypotEvents", missingHoneypots)}><ListPlus size={14} />Ajouter les {missingHoneypots.length} pièges recommandés</button>
              )}
              {key === "protectedEvents" && newScannerEvents.length > 0 && (
                <button type="button" className="btn sm" style={{ justifySelf: "start" }} onClick={() => addLines("protectedEvents", newScannerEvents)} title={newScannerEvents.join(", ")}>
                  <ScanSearch size={14} />Protéger les {newScannerEvents.length} événement{newScannerEvents.length > 1 ? "s" : ""} exploitable{newScannerEvents.length > 1 ? "s" : ""} trouvé{newScannerEvents.length > 1 ? "s" : ""} par le scanner
                </button>
              )}
            </div>
          ))}
          <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span><b>Événements ciblés</b> <span className="muted" style={{ fontSize: 12 }}>· {parseTargeted(targeted).length}</span></span>
              <span className="muted" style={{ fontSize: 12 }}>Événements dont le 1er paramètre est le joueur visé (menottes, réanimation, prison, facture) et la distance maximale en mètres : « événement, 15 ». Déclenché sur quelqu&apos;un de plus loin, ou sur tout le serveur : détection « Action à distance ».</span>
              <textarea className="field" rows={7} value={targeted} onChange={(e) => setTargeted(e.target.value)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} placeholder="esx_policejob:handcuff, 15" />
            </label>
            {missingTargeted.length > 0 && (
              <button type="button" className="btn sm" style={{ justifySelf: "start" }} onClick={() => setTargeted([...parseTargeted(targeted), ...missingTargeted].map((t) => `${t.event}, ${t.maxDistance}`).join("\n"))}>
                <ListPlus size={14} />Ajouter les {missingTargeted.length} événements ESX / QBCore recommandés
              </button>
            )}
          </div>
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <b>Types d&apos;explosion bloqués</b>
            <span className="muted" style={{ fontSize: 12 }}>Numéros GTA séparés par des virgules (vide : seules les explosions invisibles sont bloquées).</span>
            <input className="field" value={explosions} onChange={(e) => setExplosions(e.target.value)} placeholder="ex. 7, 29, 37" />
          </label>
        </div>
      </section>

      <div className="save-bar">
        <button className="btn primary" disabled={busy}>Enregistrer les réglages</button>
        <button type="button" className="btn" disabled={busy} onClick={() => { setS(initial); setTexts(Object.fromEntries(LISTS.map(([k]) => [k, initial[k].join("\n")])) as typeof texts); setTargeted(targetedText(initial.targetedEvents)); setExplosions(initial.blockedExplosions.join(", ")); setBlockedNames(initial.connection.blockedNames.join("\n")); setWhitelist(initial.connection.whitelist.join("\n")); }}>Annuler les modifications</button>
      </div>
    </form>
  );
}
