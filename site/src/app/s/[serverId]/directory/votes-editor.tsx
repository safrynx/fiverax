"use client";
import { useState } from "react";
import { Gift, Plus, Save, ThumbsUp, Trash2, Trophy } from "lucide-react";
import type { VoteRow } from "@/lib/votes";
import { REWARD_LABEL, rewardText, VOTE_ACCOUNTS, VOTE_COOLDOWN_HOURS, type RewardStatus, type VoteReward, type VoteSettings } from "@/lib/votes-shared";
import { formatDateTime } from "@/lib/format";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

type Stats = { month: number; previousMonth: number; rank: number | null; recent: VoteRow[]; top: { username: string; votes: number }[] };

const TONE: Partial<Record<RewardStatus, string>> = { delivered: "up", failed: "danger", expired: "warn", pending: "info", sent: "info", no_player: "warn" };

/** Rewards of the votes in the directory, and who voted. */
export default function VotesEditor({ initial, stats, slug, published }: { initial: VoteSettings; stats: Stats; slug: string; published: boolean }) {
  const paths = useServerPaths();
  const { toast } = useUI();
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const setReward = (i: number, r: VoteReward) => setForm((f) => ({ ...f, rewards: f.rewards.map((x, j) => (j === i ? r : x)) }));
  const removeReward = (i: number) => setForm((f) => ({ ...f, rewards: f.rewards.filter((_, j) => j !== i) }));
  const addReward = (type: VoteReward["type"]) =>
    setForm((f) => ({ ...f, rewards: [...f.rewards, type === "money" ? { type, account: "cash", amount: 2500 } : { type, item: "", label: "", count: 1 }] }));

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(paths.api("directory?action=votes"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: form }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast(describeApiError(data, res.status), "error");
      setSaved(data as VoteSettings);
      setForm(data as VoteSettings);
      toast("Récompenses enregistrées.", "ok");
    } catch {
      toast("Impossible de joindre le panel.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cols even" style={{ marginTop: 34 }}>
      <section className="rise rise-2">
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 12, borderBottom: "1px solid var(--line-2)" }}>
          <h2 className="h2" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Gift size={15} />Récompenses de vote</h2>
          <button className="btn sm primary" disabled={busy || !dirty} onClick={save}><Save size={13} />Enregistrer</button>
        </header>
        <p className="muted" style={{ fontSize: 13 }}>
          Les joueurs votent sur ta fiche une fois toutes les {VOTE_COOLDOWN_HOURS} h, connectés avec Discord. Avec les récompenses, l&apos;agent les donne en jeu
          au joueur dont le Discord est relié à FiveM : tout de suite s&apos;il joue, sinon à sa prochaine connexion (agent 3.7, ESX, QBCore ou Qbox, ox_inventory pour les objets).
        </p>
        <label className="check" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={form.rewardsEnabled} onChange={(e) => setForm((f) => ({ ...f, rewardsEnabled: e.target.checked, rewards: e.target.checked && f.rewards.length === 0 ? [{ type: "money", account: "cash", amount: 2500 }] : f.rewards }))} />
          Donner une récompense en jeu à chaque vote
        </label>
        {form.rewardsEnabled && (
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            {form.rewards.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {r.type === "money" ? (
                  <>
                    <input className="field" type="number" min={1} max={10_000_000} value={r.amount} style={{ width: 140 }} onChange={(e) => setReward(i, { ...r, amount: Math.max(1, Math.floor(Number(e.target.value) || 0)) })} />
                    <span>$ en</span>
                    <select className="field" value={r.account} style={{ width: "auto" }} onChange={(e) => setReward(i, { ...r, account: e.target.value as typeof r.account })}>
                      {VOTE_ACCOUNTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    <input className="field" type="number" min={1} max={1000} value={r.count} style={{ width: 80 }} onChange={(e) => setReward(i, { ...r, count: Math.max(1, Math.floor(Number(e.target.value) || 0)) })} />
                    <span>×</span>
                    <input className="field" value={r.item} placeholder="nom de l'objet (bread)" style={{ width: 170 }} onChange={(e) => setReward(i, { ...r, item: e.target.value.trim() })} />
                    <input className="field" value={r.label} placeholder="nom affiché (Pain)" style={{ width: 150 }} maxLength={40} onChange={(e) => setReward(i, { ...r, label: e.target.value })} />
                  </>
                )}
                <button className="ibtn bad" title="Retirer" onClick={() => removeReward(i)}><Trash2 size={12} /></button>
              </div>
            ))}
            {form.rewards.length < 3 && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn sm" onClick={() => addReward("money")}><Plus size={13} />Argent</button>
                <button className="btn sm" onClick={() => addReward("item")}><Plus size={13} />Objet</button>
              </div>
            )}
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Message en jeu</span>
              <input className="field" value={form.message} maxLength={150} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
            </label>
            {form.rewards.length > 0 && <p className="muted" style={{ fontSize: 12, margin: 0 }}>Affiché sur ta fiche : « À chaque vote, en jeu : {form.rewards.map(rewardText).join(", ")} ».</p>}
          </div>
        )}
      </section>

      <section className="rise rise-3">
        <header style={{ paddingBottom: 12, borderBottom: "1px solid var(--line-2)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 className="h2" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><ThumbsUp size={15} />Votes</h2>
          {published && <a href={`/annuaire/${slug}#vote`} target="_blank" rel="noopener noreferrer" className="linkish">Lien à partager aux joueurs</a>}
        </header>
        <div className="strip" style={{ marginTop: 14 }}>
          <div><div className="eyebrow">Ce mois</div><div className="num">{stats.month}</div></div>
          <div><div className="eyebrow">Mois dernier</div><div className="num">{stats.previousMonth}</div></div>
          <div><div className="eyebrow">Classement</div><div className="num">{stats.rank ? `#${stats.rank}` : "—"}</div></div>
        </div>
        {stats.top.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}><Trophy size={12} />Meilleurs votants du mois</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{stats.top.map((t) => <span key={t.username} className="tag">{t.username} · {t.votes}</span>)}</div>
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          {stats.recent.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Pas encore de vote. Partage le lien de ta fiche sur ton Discord (« vote toutes les {VOTE_COOLDOWN_HOURS} h »).</p>}
          {stats.recent.map((v) => (
            <div key={v.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
              <b style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{v.username}</b>
              <span className="muted num-cell">{formatDateTime(v.votedAt)}</span>
              {v.reward !== "none" && <span className="tag" data-tone={TONE[v.reward]} title={v.note ?? undefined}>{REWARD_LABEL[v.reward]}</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
