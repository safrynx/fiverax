"use client";
import { useEffect, useState } from "react";
import { Gift, ThumbsUp, Trophy } from "lucide-react";
import { MIN_ACCOUNT_AGE_DAYS, VOTE_COOLDOWN_HOURS, type RewardStatus, type VoteState } from "@/lib/votes-shared";
import { describeApiError, useUI } from "@/app/ui";

const at = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Remaining time until `iso`, refreshed every 30 s ("1 h 12", "8 min"). */
function useCountdown(iso: string | null): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!iso) return;
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [iso]);
  if (!iso) return null;
  const left = Math.max(0, new Date(iso).getTime() - Date.now());
  if (left === 0) return null;
  const minutes = Math.ceil(left / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`;
}

const REWARD_AFTER_VOTE: Partial<Record<RewardStatus, string>> = {
  sent: "Ta récompense arrive en jeu dans quelques secondes.",
  pending: "Ta récompense t'attend : elle arrive en jeu une minute après ta connexion (7 jours max).",
  no_player: "Pas de récompense cette fois : relie ton Discord à FiveM (Paramètres > Comptes liés) et joue une fois sur ce serveur."
};

export default function VoteBox({ slug, serverName, initial }: { slug: string; serverName: string; initial: VoteState }) {
  const { toast } = useUI();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [after, setAfter] = useState<string | null>(null);
  const countdown = useCountdown(state.reason === "cooldown" ? state.nextAt : null);
  const loginHref = `/api/auth/discord?next=${encodeURIComponent(`/annuaire/${slug}#vote`)}`;
  const canVote = state.canVote || (state.reason === "cooldown" && !countdown);

  async function vote() {
    setBusy(true);
    try {
      const res = await fetch("/api/directory?action=vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(describeApiError(data, res.status), "error");
        return;
      }
      setState((s) => ({ ...s, month: Number(data.month ?? s.month + 1), canVote: false, reason: "cooldown", nextAt: String(data.nextAt) }));
      setAfter(REWARD_AFTER_VOTE[data.reward as RewardStatus] ?? null);
      toast(`Merci ! Ton vote pour ${serverName} est compté.`, "ok");
    } catch {
      toast("Impossible de joindre Fiverax.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="vote" className="dir-panel dir-vote" style={{ scrollMarginTop: 90 }}>
      <h2>Voter pour {serverName}</h2>
      <div className="dir-vote-count">
        <span className="dir-live-num">{state.month}</span>
        <span className="muted">vote{state.month > 1 ? "s" : ""} ce mois</span>
        {state.rank && <span className="dir-vote-rank"><Trophy size={13} />#{state.rank} de l&apos;annuaire</span>}
      </div>
      {state.rewards.length > 0 && (
        <p className="dir-vote-reward"><Gift size={14} /><span>À chaque vote, en jeu : <b>{state.rewards.join(", ")}</b></span></p>
      )}

      {state.reason === "unpublished" ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Les votes s&apos;ouvrent quand la fiche est publiée.</p>
      ) : state.reason === "login" ? (
        <a href={loginHref} className="btn primary shine" style={{ width: "100%", justifyContent: "center" }}><ThumbsUp size={15} />Se connecter avec Discord pour voter</a>
      ) : state.reason === "young_account" ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Ton compte Discord a moins de {MIN_ACCOUNT_AGE_DAYS} jours : il ne peut pas encore voter.</p>
      ) : canVote ? (
        <button className="btn primary shine" style={{ width: "100%", justifyContent: "center" }} disabled={busy} onClick={vote}><ThumbsUp size={15} />Voter</button>
      ) : (
        <button className="btn" style={{ width: "100%", justifyContent: "center" }} disabled>Prochain vote dans {countdown}{state.nextAt ? ` (${at(state.nextAt)})` : ""}</button>
      )}
      {after && <p style={{ margin: "10px 0 0", fontSize: 13 }}>{after}</p>}
      {!after && state.rewards.length > 0 && state.reason !== "login" && !state.linked && (
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 12 }}>Pour recevoir la récompense, ton Discord doit être relié à FiveM et tu dois avoir joué une fois sur ce serveur.</p>
      )}
      <p className="muted" style={{ margin: "10px 0 0", fontSize: 12 }}>Un vote toutes les {VOTE_COOLDOWN_HOURS} h par compte Discord. Les votes du mois classent l&apos;annuaire.</p>
    </div>
  );
}
