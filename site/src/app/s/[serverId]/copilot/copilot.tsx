"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Play, RotateCcw, Search, Sparkles, Zap } from "lucide-react";
import type { CopilotAction, CopilotReply } from "@/lib/copilot-shared";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";
import { useCommand } from "../use-command";

type Message = {
  role: "user" | "assistant";
  content: string;
  /** Written by the panel (what it looked up, outcome of actions), not by the admin. */
  auto?: "lookup" | "result";
  actions?: CopilotAction[];
  rejected?: string[];
  /** Actions already run from this message (index → outcome). */
  done?: Record<number, "ok" | "failed">;
};

const storageKey = (serverId: string) => `fiverax-copilot:${serverId}`;

/** Plain text with **bold** (the model's habit), line breaks kept. */
function Rich({ text }: { text: string }) {
  return (
    <span style={{ whiteSpace: "pre-wrap" }}>
      {text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>
      )}
    </span>
  );
}

export default function Copilot({ aiReady, quick }: { aiReady: boolean; quick: string[] }) {
  const paths = useServerPaths();
  const { ask, toast } = useUI();
  const { run: runCommand } = useCommand();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [running, setRunning] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef<Message[]>([]);
  latest.current = messages;

  // The conversation survives a reload (this browser only).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(paths.serverId)) ?? "null") as Message[] | null;
      if (Array.isArray(saved)) setMessages(saved);
    } catch { /* storage unavailable */ }
  }, [paths.serverId]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(paths.serverId), JSON.stringify(messages.slice(-40)));
    } catch { /* storage unavailable */ }
  }, [paths.serverId, messages]);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages, thinking]);

  async function question(text: string) {
    const content = text.trim();
    if (!content || thinking || running) return;
    const start: Message[] = [...latest.current, { role: "user", content }];
    setMessages(start);
    setInput("");
    setThinking(true);
    try {
      const res = await fetch(paths.api("copilot"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: start.slice(-24).map(({ role, content: c }) => ({ role, content: c.slice(0, 4000) })) })
      }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : null;
      if (!res || !res.ok) {
        toast(data ? describeApiError(data, res!.status) : "Impossible de joindre le panel.", "error");
        return;
      }
      const reply = data as CopilotReply;
      const next: Message[] = [...start];
      // What the panel looked up stays in the conversation: the next questions can rely on it (ids of warnings, bans…).
      if (reply.lookups.length) next.push({ role: "user", auto: "lookup", content: `[Données consultées par le panel]\n${reply.lookups.join("\n\n")}`.slice(0, 3990) });
      next.push({ role: "assistant", content: reply.answer, actions: reply.actions, rejected: reply.rejected });
      setMessages(next);
    } finally {
      setThinking(false);
    }
  }

  /** Run one action through the panel's usual API. */
  async function execute(a: CopilotAction): Promise<{ ok: boolean; result: string }> {
    if (a.via === "command") {
      const r = await runCommand(a.kind, a.payload, a.description);
      return { ok: r.ok, result: r.result ?? (r.ok ? "fait" : "échec") };
    }
    if (a.via !== "api") return { ok: true, result: "" };
    const res = await fetch(paths.api(a.path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a.body) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : null;
    if (!res || !res.ok) {
      const message = data ? describeApiError(data, res!.status) : "Impossible de joindre le panel.";
      toast(message, "error");
      return { ok: false, result: message };
    }
    toast(`Fait : ${a.label}`, "ok");
    return { ok: true, result: data?.remaining ? `fait (${data.remaining} restant(s), relance pour continuer)` : "fait" };
  }

  /** Some actions of a message (one confirmation for all), then tell the conversation what came of them. */
  async function runActions(index: number, picks: number[]) {
    const m = latest.current[index];
    const list = picks.map((j) => ({ j, a: m.actions![j] })).filter((x) => x.a.via !== "link");
    if (!list.length || running) return;
    const ok = await ask({
      title: list.length === 1 ? `${list[0].a.description} ?` : `Exécuter ces ${list.length} actions ?`,
      message: `${list.map((x) => `• ${x.a.description}`).join("\n")}\n\nProposé par le Copilote, exécuté avec tes droits et enregistré dans les logs.`,
      confirmLabel: "Exécuter",
      danger: list.some((x) => x.a.danger)
    });
    if (!ok) return;
    setRunning(true);
    const outcomes: string[] = [];
    try {
      for (const { j, a } of list) {
        const r = await execute(a);
        outcomes.push(`${a.description} → ${r.ok ? "OK" : "ÉCHEC"}${r.result && r.result !== "fait" ? ` : ${r.result}` : ""}`);
        setMessages((old) => old.map((x, k) => (k === index ? { ...x, done: { ...x.done, [j]: r.ok ? "ok" : "failed" } } : x)));
      }
    } finally {
      setRunning(false);
    }
    setMessages((old) => [...old, { role: "user", auto: "result", content: `[Résultat des actions]\n${outcomes.join("\n")}` }]);
  }

  const busy = thinking || running;

  return (
    <>
      {!aiReady && <div className="banner"><b>IA non configurée :</b> ajoute AI_API_KEY dans l&apos;environnement du site.</div>}

      <section className="rise rise-2">
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", paddingBottom: 12, borderBottom: "1px solid var(--line-2)" }}>
          <h2 className="h2" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Sparkles size={16} />Conversation</h2>
          {messages.length > 0 && <button className="btn sm" onClick={() => setMessages([])} disabled={busy}><RotateCcw size={13} />Nouvelle conversation</button>}
        </header>

        <div ref={box} style={{ display: "grid", gap: 12, marginTop: 14, maxHeight: "64vh", overflowY: "auto", padding: 2 }}>
          {messages.length === 0 && !thinking && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {quick.map((q) => <button key={q} className="btn sm" disabled={!aiReady} onClick={() => question(q)}><Sparkles size={13} />{q}</button>)}
            </div>
          )}
          {messages.map((m, i) => (
            <MessageView key={i} m={m} busy={busy} onRun={(picks) => runActions(i, picks)} />
          ))}
          {thinking && <div className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Sparkles size={14} />Le Copilote réfléchit…</div>}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); question(input); }} style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); question(input); } }}
            placeholder="Ex. : avertis Bob pour absence en réunion, monte Lucas modérateur, qui est le plus actif cette semaine ?"
            className="field"
            rows={2}
            maxLength={4000}
            style={{ flex: 1, minWidth: 240, resize: "vertical" }}
          />
          <button className="btn primary" disabled={busy || !input.trim() || !aiReady}>Demander</button>
        </form>
      </section>
    </>
  );
}

function MessageView({ m, busy, onRun }: { m: Message; busy: boolean; onRun: (picks: number[]) => void }) {
  if (m.role === "user") {
    if (m.auto === "lookup") {
      return (
        <details className="muted" style={{ fontSize: 12, paddingLeft: 6, borderLeft: "2px solid var(--line-2)" }}>
          <summary style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}><Search size={11} />Le Copilote a consulté le panel</summary>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{m.content.replace(/^\[Données consultées par le panel\]\n/, "")}</div>
        </details>
      );
    }
    if (m.auto) return <div className="muted" style={{ fontSize: 12, whiteSpace: "pre-wrap", paddingLeft: 6, borderLeft: "2px solid var(--line-2)" }}>{m.content.replace(/^\[Résultat des actions\]\n/, "")}</div>;
    return <div style={{ justifySelf: "end", maxWidth: "80%", padding: "10px 14px", borderRadius: 12, border: "1px solid var(--line-2)", background: "rgba(var(--accent-rgb), 0.1)", whiteSpace: "pre-wrap", fontSize: 14 }}>{m.content}</div>;
  }

  const actions = m.actions ?? [];
  const pending = actions.map((_, j) => j).filter((j) => actions[j].via !== "link" && m.done?.[j] !== "ok");
  return (
    <div style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid var(--line-2)", background: "var(--surface)", fontSize: 14, lineHeight: 1.55 }}>
      <Rich text={m.content} />
      {actions.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {actions.map((a, j) => {
            if (a.via === "link") {
              return <Link key={j} href={a.href} className="btn sm"><ArrowRight size={13} />{a.label}</Link>;
            }
            const done = m.done?.[j];
            return (
              <button
                key={j}
                className="btn sm"
                data-tone={done === "failed" ? "danger" : a.danger ? "danger" : undefined}
                disabled={busy || done === "ok"}
                title={a.description}
                onClick={() => onRun([j])}
              >
                {done === "ok" ? <Check size={13} /> : <Zap size={13} />}{a.label}{done === "failed" ? " (échec, réessayer)" : ""}
              </button>
            );
          })}
          {pending.length > 1 && <button className="btn sm primary" disabled={busy} onClick={() => onRun(pending)}><Play size={13} />Tout exécuter ({pending.length})</button>}
        </div>
      )}
      {m.rejected && m.rejected.length > 0 && (
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>Écarté par le panel : {m.rejected.join(" · ")}</p>
      )}
    </div>
  );
}
