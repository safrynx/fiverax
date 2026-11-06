"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Dices, Eye, Inbox, X } from "lucide-react";
import { RESPONSE_STATUS_LABEL } from "@/lib/portal-site-shared";
import type { StaffGiveaway, StaffResponse } from "@/lib/portal-site";
import { formatDateTime, formatDuration } from "@/lib/format";
import { REWARD_LABEL, type RewardStatus } from "@/lib/votes-shared";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

function usePost() {
  const paths = useServerPaths();
  const { toast } = useUI();
  return async (action: string, body: unknown) => {
    const res = await fetch(paths.api(`portal?action=${action}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: "network" };
    if (!res?.ok) {
      toast(res ? describeApiError(data, res.status) : "Impossible de joindre le panel.", "error");
      return null;
    }
    return data as Record<string, unknown>;
  };
}

const TONE = { new: "warn", seen: "info", accepted: "up", refused: "danger" } as const;

/** Answers to the portal's forms: read, accept or refuse, with a reply the player reads on the portal. */
export function ResponsesView({ responses, all }: { responses: StaffResponse[]; all: boolean }) {
  const paths = useServerPaths();
  const router = useRouter();
  const { toast, ask } = useUI();
  const post = usePost();
  const [busy, setBusy] = useState<number | null>(null);
  const forms = [...new Set(responses.map((r) => r.formTitle))];
  const [form, setForm] = useState<string>("all");
  const shown = responses.filter((r) => form === "all" || r.formTitle === form);

  async function decide(r: StaffResponse, status: "seen" | "accepted" | "refused") {
    let reply: string | null = null;
    if (status !== "seen") {
      const answer = await ask({
        title: status === "accepted" ? `Accepter la réponse de ${r.username} ?` : `Refuser la réponse de ${r.username} ?`,
        message: "Le joueur verra la décision et ton message sur le portail.",
        input: { label: "Message au joueur (facultatif)", multiline: true, initial: r.reply ?? "" },
        confirmLabel: status === "accepted" ? "Accepter" : "Refuser",
        danger: status === "refused"
      });
      if (!answer) return;
      reply = answer.value.trim() || null;
    }
    setBusy(r.id);
    try {
      if (await post("respond", { id: r.id, status, reply })) {
        toast(status === "seen" ? "Marquée comme lue." : status === "accepted" ? "Acceptée." : "Refusée.", "ok");
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="filters" style={{ marginBottom: 16 }}>
        <div className="pill-tabs">
          <Link href={paths.page("/portal?tab=responses")} data-on={!all}>À traiter</Link>
          <Link href={paths.page("/portal?tab=responses&all=1")} data-on={all}>Toutes</Link>
        </div>
        {forms.length > 1 && (
          <select className="field" value={form} onChange={(e) => setForm(e.target.value)}>
            <option value="all">Tous les formulaires</option>
            {forms.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
      </div>
      {shown.length === 0 ? (
        <div className="audit-empty"><Inbox size={22} /><p>{all ? "Aucune réponse pour l'instant." : "Rien à traiter."} Ajoute un bloc Formulaire au portail pour recevoir des candidatures.</p></div>
      ) : (
        <div className="pe-resp">
          {shown.map((r) => (
            <article key={r.id}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <b>{r.username}</b>
                <span className="tag">{r.formTitle}</span>
                <span className="tag" data-tone={TONE[r.status]}>{RESPONSE_STATUS_LABEL[r.status]}</span>
                <span className="muted" style={{ fontSize: 12 }}>{formatDateTime(r.createdAt)}{r.playSeconds !== null ? ` · ${formatDuration(r.playSeconds)} de jeu` : ""} · <code>{r.discordId}</code></span>
              </div>
              <dl>
                {r.answers.map((a, i) => <div key={i}><dt>{a.question}</dt><dd>{a.answer || <span className="muted">—</span>}</dd></div>)}
              </dl>
              {r.reply && <p className="muted" style={{ fontSize: 13 }}>Réponse{r.decidedName ? ` de ${r.decidedName}` : ""} : {r.reply}</p>}
              <div className="pe-bar">
                <button className="btn sm primary" disabled={busy === r.id} onClick={() => decide(r, "accepted")}><Check size={13} />Accepter</button>
                <button className="btn sm" disabled={busy === r.id} onClick={() => decide(r, "refused")}><X size={13} />Refuser</button>
                {r.status === "new" && <button className="btn sm" disabled={busy === r.id} onClick={() => decide(r, "seen")}><Eye size={13} />Marquer comme lue</button>}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

/** Giveaways of the portal: entries, draw (automatic at the end date, or now), winners and their in-game reward. */
export function GiveawaysView({ giveaways, published }: { giveaways: StaffGiveaway[]; published: boolean }) {
  const router = useRouter();
  const { toast, ask } = useUI();
  const post = usePost();
  const [busy, setBusy] = useState<string | null>(null);

  async function draw(g: StaffGiveaway) {
    const ok = await ask({ title: `Tirer « ${g.title} » maintenant ?`, message: `${g.entries} inscrit(s). Les inscriptions ferment et les gagnants sont annoncés sur le portail.`, confirmLabel: "Tirer au sort" });
    if (!ok) return;
    setBusy(g.blockId);
    try {
      const data = await post("draw", { blockId: g.blockId });
      if (data) {
        const winners = (data.winners as string[]) ?? [];
        toast(winners.length ? `Gagnant(s) : ${winners.join(", ")}` : "Aucun inscrit : pas de gagnant.", "ok");
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  if (!giveaways.length) {
    return <div className="audit-empty"><Dices size={22} /><p>Aucun giveaway. Ajoute un bloc Giveaway dans l&apos;éditeur{published ? "" : ", puis publie le portail"}.</p></div>;
  }
  return (
    <div className="pe-resp">
      {giveaways.map((g) => (
        <article key={g.blockId}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <b>{g.title}</b>
            {g.prize && <span className="tag" data-tone="info">{g.prize}</span>}
            <span className="tag" data-tone={g.drawnAt ? "up" : "warn"}>{g.drawnAt ? `Tiré le ${formatDateTime(g.drawnAt)}` : g.endsAt ? `Fin le ${formatDateTime(g.endsAt)}` : "Sans date de fin"}</span>
            {!g.published && <span className="tag">Retiré du portail</span>}
          </div>
          <p className="muted" style={{ margin: "8px 0" }}>{g.entries} inscrit{g.entries > 1 ? "s" : ""}{!g.drawnAt && g.endsAt ? " · tirage automatique à la date de fin" : ""}</p>
          {g.winners.length > 0 && (
            <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
              {g.winners.map((w) => (
                <li key={w.username}><b>{w.username}</b> · <span className="muted">{w.reward === "none" ? "pas de récompense en jeu" : REWARD_LABEL[w.reward as RewardStatus] ?? w.reward}{w.note ? ` (${w.note})` : ""}</span></li>
              ))}
            </ul>
          )}
          {g.drawnAt && g.winners.length === 0 && <p className="muted">Aucun inscrit au moment du tirage.</p>}
          {!g.drawnAt && g.published && <button className="btn sm primary" disabled={busy === g.blockId} onClick={() => draw(g)}><Dices size={13} />Tirer au sort maintenant</button>}
        </article>
      ))}
    </div>
  );
}
