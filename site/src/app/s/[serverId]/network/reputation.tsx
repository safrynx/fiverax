import { categoryLabel, KEY_KINDS, type Reputation } from "@/lib/network-shared";
import { formatDateTime } from "@/lib/format";
import { GuildIcon } from "@/app/new-server-form";

const CATEGORY_TONE: Record<string, string> = { cheat: "danger", exploit: "danger", raid: "danger", scam: "warn", toxic: "warn", other: "neutral" };

/** Bans of the other network servers matching a player (player page, network lookup). */
export default function ReputationList({ rep, empty }: { rep: Reputation; empty: string }) {
  if (rep.records.length === 0) return <p className="muted" style={{ padding: "14px 0", margin: 0 }}>{empty}</p>;
  return (
    <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
      {rep.records.map((r) => (
        <li key={r.banId} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
          <GuildIcon url={r.serverIcon} name={r.serverName} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <b>{r.serverName}</b>
              <span className="tag" data-tone={CATEGORY_TONE[r.category] ?? "neutral"}>{categoryLabel(r.category)}</span>
              {!r.expiresAt && <span className="tag" data-tone="danger">Définitif</span>}
            </div>
            <div style={{ marginTop: 3 }}>{r.reason}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              « {r.playerName} » · {formatDateTime(r.createdAt)}{r.expiresAt ? ` → ${formatDateTime(r.expiresAt)}` : ""}
              {r.matchedOn.length > 0 && <> · reconnu par {r.matchedOn.map((k) => KEY_KINDS[k] ?? k).join(", ")}</>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
