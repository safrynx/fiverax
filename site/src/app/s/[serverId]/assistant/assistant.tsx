"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Bot, Check, FileCode2, FolderOpen, Megaphone, Play, RotateCcw, Sparkles, Terminal, Undo2, UserRound, X } from "lucide-react";
import type { LiveState } from "@/lib/agent";
import type { TroubleshootAction } from "@/lib/troubleshoot";
import { CHANGE_STATUS, diffHunks, lineDiff, type ResourceChange } from "@/lib/resource-files-shared";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";
import { useCommand, usePolling } from "../use-command";
import { AgentBanner } from "../live/live-view";

type FileRef = { resource: string; path: string };
type ReadInfo = { commandId: number; resource: string; paths?: string[]; status: "pending" | "done" | "failed"; message?: string | null; got?: string[] };
type Message = {
  role: "user" | "assistant";
  content: string;
  /** Written by the panel (files read, edit refused), not by the admin. */
  auto?: boolean;
  actions?: TroubleshootAction[];
  reads?: ReadInfo[];
  changeId?: number;
  rejected?: string[];
  /** Actions already run from this message (index → outcome). */
  done?: Record<number, "ok" | "failed">;
};
type Saved = { messages: Message[]; opened: FileRef[]; listed: string[] };

type Props = { initial: LiveState; initialChanges: ResourceChange[]; canFiles: boolean; allowed: string[]; aiReady: boolean; settingsHref: string | null };

/** The panel command an action runs, and its payload. */
function commandOf(a: TroubleshootAction): { kind: string; payload: Record<string, unknown>; description: string; danger: boolean } {
  switch (a.kind) {
    case "console": return { kind: "console", payload: { command: a.command }, description: `Commande console : ${a.command}`, danger: false };
    case "resource": return { kind: "resource", payload: { action: a.action, name: a.name }, description: `${{ start: "Démarrer", stop: "Arrêter", restart: "Redémarrer" }[a.action]} ${a.name}`, danger: a.action === "stop" };
    case "announce": return { kind: "announce", payload: { message: a.message }, description: `Annonce à tout le serveur : « ${a.message} »`, danger: false };
    case "player": return {
      kind: a.command, payload: a.payload, description: a.description,
      danger: a.command === "kick" || (a.command === "game" && (a.payload.op === "remove_money" || a.payload.op === "remove_item"))
    };
  }
}
const kindOf = (a: TroubleshootAction) => (a.kind === "player" ? a.command : a.kind);
const QUICK_ADMIN = "Qui est connecté en ce moment ? Résume-moi le serveur.";

const QUICK = [
  "Analyse les erreurs récentes de la console et corrige-les.",
  "Quelles ressources devraient tourner et sont arrêtées ? Pourquoi ?",
  "Le serveur lag : qu'est-ce que tu vois de suspect ?"
];
const MAX_STEPS = 5;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function blocks(text: string): { code: boolean; body: string }[] {
  const out: { code: boolean; body: string }[] = [];
  const re = /```[\w-]*\n?([\s\S]*?)```/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ code: false, body: text.slice(last, m.index) });
    out.push({ code: true, body: m[1].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ code: false, body: text.slice(last) });
  return out;
}

const storageKey = (api: string) => `fiverax-assistant:${api}`;

export default function Assistant({ initial, initialChanges, canFiles, allowed, aiReady, settingsHref }: Props) {
  const paths = useServerPaths();
  const { ask, toast } = useUI();
  const { run: runCommand, busy: running } = useCommand();
  const { data: live, refresh } = usePolling<LiveState>(paths.api("live"), initial, 5000);
  const api = paths.api("assistant");

  const [messages, setMessages] = useState<Message[]>([]);
  const [opened, setOpened] = useState<FileRef[]>([]);
  const [listed, setListed] = useState<string[]>([]);
  const [changes, setChanges] = useState<Record<number, ResourceChange>>(() => Object.fromEntries(initialChanges.map((c) => [c.id, c])));
  const [history, setHistory] = useState<number[]>(initialChanges.map((c) => c.id));
  const [input, setInput] = useState("");
  const [resource, setResource] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef<{ messages: Message[]; opened: FileRef[]; listed: string[] }>({ messages: [], opened: [], listed: [] });
  latest.current = { messages, opened, listed };

  // The conversation survives a reload (this browser only).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(api)) ?? "null") as Saved | null;
      if (saved?.messages) {
        setMessages(saved.messages);
        setOpened(saved.opened ?? []);
        setListed(saved.listed ?? []);
      }
    } catch { /* storage unavailable */ }
  }, [api]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(api), JSON.stringify({ messages: messages.slice(-40), opened, listed } satisfies Saved));
    } catch { /* storage unavailable */ }
  }, [api, messages, opened, listed]);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages, step]);

  // Changes of this conversation: load the ones the page does not know yet.
  useEffect(() => {
    const missing = messages.map((m) => m.changeId).filter((id): id is number => Boolean(id) && !changes[id!]);
    for (const id of missing) {
      fetch(`${api}?change=${id}`).then((r) => (r.ok ? r.json() : null)).then((c: ResourceChange | null) => c && setChanges((old) => ({ ...old, [c.id]: c }))).catch(() => {});
    }
  }, [messages, changes, api]);

  const followRead = useCallback(async (read: ReadInfo): Promise<ReadInfo & { list?: boolean; files: { path: string; missing?: boolean; error?: string }[] }> => {
    for (let i = 0; i < 40; i++) {
      await wait(i < 6 ? 1000 : 2000);
      const s = await fetch(`${api}?read=${read.commandId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (s && s.status !== "pending") return { ...read, status: s.status, message: s.message, list: s.op === "list", files: s.files ?? [] };
    }
    return { ...read, status: "failed", message: "Le serveur FiveM n'a pas répondu à temps", files: [] };
  }, [api]);

  /** One question, then as many automatic steps as the AI needs to read files (MAX_STEPS). */
  async function converse(start: Message[], files: FileRef[], res: string[], depth = 0): Promise<void> {
    setStep(depth === 0 ? "L'IA analyse le serveur…" : "L'IA lit les fichiers…");
    const res0 = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: start.slice(-24).map(({ role, content }) => ({ role, content: content.slice(0, 4000) })),
        resource: resource || undefined,
        files: files.slice(-15),
        listed: res.slice(-6)
      })
    }).catch(() => null);
    const data = res0 ? await res0.json().catch(() => ({})) : null;
    if (!res0 || !res0.ok) {
      toast(data ? describeApiError(data, res0!.status) : "Impossible de joindre le panel.", "error");
      return;
    }
    const reads: ReadInfo[] = (data.reads ?? []).map((r: ReadInfo) => ({ ...r, status: "pending" }));
    const reply: Message = { role: "assistant", content: data.answer, actions: data.actions ?? [], reads, changeId: data.change?.id, rejected: data.rejected ?? [] };
    if (data.change) setChanges((old) => ({ ...old, [data.change.id]: data.change }));
    let convo = [...start, reply];
    setMessages(convo);

    const notes: string[] = [];
    let nextFiles = files, nextListed = res;
    if (reads.length) {
      setStep("Lecture des fichiers sur le serveur…");
      const done = await Promise.all(reads.map(followRead));
      for (const r of done) {
        if (r.status === "failed") {
          notes.push(`${r.resource} : lecture impossible (${r.message ?? "erreur"})`);
          continue;
        }
        const got = r.files.filter((f) => !f.missing && !f.error).map((f) => ({ resource: r.resource, path: f.path }));
        const absent = r.files.filter((f) => f.missing).map((f) => f.path);
        const refused = r.files.filter((f) => f.error).map((f) => `${f.path} (${f.error})`);
        if (r.list) nextListed = [...nextListed.filter((x) => x !== r.resource), r.resource];
        nextFiles = [...nextFiles.filter((f) => !got.some((g) => g.resource === f.resource && g.path === f.path)), ...got];
        notes.push(
          [r.list ? `Liste des fichiers de ${r.resource} reçue` : "", got.length ? `lus : ${got.map((g) => `${g.resource}/${g.path}`).join(", ")}` : "",
            absent.length ? `introuvables : ${absent.join(", ")}` : "", refused.length ? `refusés : ${refused.join(", ")}` : ""].filter(Boolean).join(" · ")
        );
        r.got = got.map((g) => g.path);
      }
      reply.reads = done;
      setOpened(nextFiles);
      setListed(nextListed);
      convo = [...start, { ...reply }];
      setMessages(convo);
    }
    if (reply.rejected?.length) notes.push(`Modifications refusées par le panel : ${reply.rejected.join(" ; ")}`);
    if (notes.length && depth < MAX_STEPS) {
      const auto: Message = { role: "user", auto: true, content: `${notes.join("\n")}\nContinue.` };
      convo = [...convo, auto];
      setMessages(convo);
      await converse(convo, nextFiles, nextListed, depth + 1);
    }
  }

  async function question(text: string) {
    const content = text.trim();
    if (!content || step) return;
    const start: Message[] = [...messages, { role: "user", content }];
    setMessages(start);
    setInput("");
    try {
      await converse(start, opened, listed);
    } finally {
      setStep(null);
    }
  }

  /** Run some actions of a message (after one confirmation), then tell the conversation what came of them. */
  async function runActions(index: number, picks: number[]) {
    const m = latest.current.messages[index];
    const list = picks.map((j) => ({ j, a: m.actions![j], c: commandOf(m.actions![j]) }));
    if (!list.length) return;
    const ok = await ask({
      title: list.length === 1 ? `${list[0].c.description} ?` : `Exécuter ces ${list.length} actions ?`,
      message: `${list.map((x) => `• ${x.c.description}`).join("\n")}\n\nProposé par l'IA, exécuté sur le serveur et enregistré dans les logs.`,
      confirmLabel: "Exécuter",
      danger: list.some((x) => x.c.danger)
    });
    if (!ok) return;
    const outcomes: string[] = [];
    let info = false;
    for (const { j, a, c } of list) {
      const res = await runCommand(c.kind, c.payload, c.description);
      outcomes.push(`${c.description} → ${res.ok ? "OK" : "ÉCHEC"}${res.result ? ` : ${res.result}` : ""}`);
      if (res.ok && a.kind === "player" && a.payload.op === "info") info = true;
      setMessages((old) => old.map((x, k) => (k === index ? { ...x, done: { ...x.done, [j]: res.ok ? "ok" : "failed" } } : x)));
    }
    refresh();
    const note: Message = { role: "user", auto: true, content: `Résultat des actions :\n${outcomes.join("\n")}\nContinue.` };
    const convo = [...latest.current.messages, note];
    setMessages(convo);
    // A lookup (money, job…) is useful only once the AI reads it: let it go on by itself.
    if (info && !step) {
      try {
        await converse(convo, latest.current.opened, latest.current.listed);
      } finally {
        setStep(null);
      }
    }
  }

  async function changeAction(id: number, action: "apply" | "revert" | "discard", restart = true) {
    if (action === "revert" && !(await ask({ title: "Annuler cette modification ?", message: "Les fichiers reprennent leur contenu d'avant (si personne ne les a modifiés depuis).", confirmLabel: "Annuler la modification", danger: true }))) return;
    const res = await fetch(`${api}?action=${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, restart }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : null;
    if (!res || !res.ok) {
      toast(data ? describeApiError(data, res!.status) : "Impossible de joindre le panel.", "error");
      return;
    }
    if (action === "discard") {
      setChanges((old) => {
        const next = { ...old };
        delete next[id];
        return next;
      });
      setMessages((old) => old.map((m) => (m.changeId === id ? { ...m, changeId: undefined } : m)));
      return;
    }
    setChanges((old) => ({ ...old, [id]: data }));
    setHistory((old) => [id, ...old.filter((x) => x !== id)]);
    // Follow the write until the agent answers.
    for (let i = 0; i < 40; i++) {
      await wait(i < 6 ? 1000 : 2000);
      const c = await fetch(`${api}?change=${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as ResourceChange | null;
      if (!c) continue;
      setChanges((old) => ({ ...old, [id]: c }));
      if (c.status !== "pending" && c.status !== "reverting") {
        toast(c.message ?? CHANGE_STATUS[c.status][0], c.status === "failed" || (action === "revert" && c.status === "applied") ? "error" : "ok");
        refresh();
        return;
      }
    }
  }

  function reset() {
    setMessages([]);
    setOpened([]);
    setListed([]);
  }

  const stopped = live.resources.filter((r) => r.state !== "started");
  const shownHistory = history.map((id) => changes[id]).filter((c): c is ResourceChange => Boolean(c) && c.status !== "proposed");

  return (
    <>
      <AgentBanner live={live} settingsHref={settingsHref} />
      {!aiReady && <div className="banner"><b>IA non configurée :</b> ajoute AI_API_KEY dans l&apos;environnement du site.</div>}

      <section className="rise rise-2">
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", paddingBottom: 12, borderBottom: "1px solid var(--line-2)" }}>
          <h2 className="h2" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Bot size={16} />Conversation</h2>
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            {opened.length > 0 && <span className="tag" data-tone="info" title={opened.map((f) => `${f.resource}/${f.path}`).join("\n")}><FolderOpen size={10} /> {opened.length} fichier(s) ouvert(s)</span>}
            {messages.length > 0 && <button className="btn sm" onClick={reset} disabled={Boolean(step)}><RotateCcw size={13} />Nouvelle conversation</button>}
          </span>
        </header>
        {!canFiles && (
          <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
            L&apos;IA ne peut pas ouvrir les fichiers : il faut la permission « Laisser l&apos;assistant IA lire et modifier les fichiers des ressources » (Administration &gt; Accès &amp; rôles).
          </p>
        )}

        <div ref={box} style={{ display: "grid", gap: 12, marginTop: 14, maxHeight: "62vh", overflowY: "auto", padding: 2 }}>
          {messages.length === 0 && !step && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[...QUICK, QUICK_ADMIN].map((q) => <button key={q} className="btn sm" disabled={!aiReady} onClick={() => question(q)}><Sparkles size={13} />{q}</button>)}
            </div>
          )}
          {messages.map((m, i) => (
            <MessageView
              key={i}
              m={m}
              change={m.changeId ? changes[m.changeId] : undefined}
              online={live.online}
              busy={running || Boolean(step)}
              allowed={allowed}
              onRun={(picks) => runActions(i, picks)}
              onChange={changeAction}
              onCheck={() => question("J'ai appliqué la modification. Vérifie la console : est-ce que c'est réglé ?")}
            />
          ))}
          {step && <div className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Sparkles size={14} />{step}</div>}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); question(input); }} style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <select value={resource} onChange={(e) => setResource(e.target.value)} className="field" style={{ maxWidth: 220 }} title="La ressource qui pose problème (facultatif) : ses lignes de console sont lues en priorité">
            <option value="">Toutes les ressources</option>
            {stopped.length > 0 && <optgroup label="Arrêtées">{stopped.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}</optgroup>}
            <optgroup label="Démarrées">{live.resources.filter((r) => r.state === "started").map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}</optgroup>
          </select>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); question(input); } }}
            placeholder="Ex. : mon job mécano ne s'ouvre plus, le garage affiche une erreur, oxmysql ne se connecte pas…"
            className="field"
            rows={2}
            maxLength={4000}
            style={{ flex: 1, minWidth: 240, resize: "vertical" }}
          />
          <button className="btn primary" disabled={Boolean(step) || !input.trim() || !aiReady}>Demander</button>
        </form>
      </section>

      {canFiles && (
        <section className="sect rise rise-3">
          <header><h2 className="h2">Modifications de fichiers <span className="muted" style={{ fontFamily: "var(--font-body)", fontSize: 13 }}>· {shownHistory.length}</span></h2></header>
          {shownHistory.length === 0 && <p className="muted">Aucune modification pour l&apos;instant. Celles que tu valides apparaissent ici et s&apos;annulent en un clic.</p>}
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {shownHistory.map((c) => <ChangeCard key={c.id} change={c} online={live.online} busy={running} onChange={changeAction} collapsed />)}
          </div>
        </section>
      )}
    </>
  );
}

function MessageView({ m, change, online, busy, allowed, onRun, onChange, onCheck }: {
  m: Message; change?: ResourceChange; online: boolean; busy: boolean; allowed: string[];
  onRun: (picks: number[]) => void; onChange: (id: number, action: "apply" | "revert" | "discard", restart?: boolean) => void; onCheck: () => void;
}) {
  if (m.role === "user") {
    if (m.auto) return <div className="muted" style={{ fontSize: 12, whiteSpace: "pre-wrap", paddingLeft: 6, borderLeft: "2px solid var(--line-2)" }}>{m.content.replace(/\nContinue\.$/, "")}</div>;
    return <div style={{ justifySelf: "end", maxWidth: "80%", padding: "10px 14px", borderRadius: 12, border: "1px solid var(--line-2)", background: "rgba(var(--accent-rgb), 0.1)", whiteSpace: "pre-wrap", fontSize: 14 }}>{m.content}</div>;
  }
  return (
    <div style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid var(--line-2)", background: "var(--surface)", fontSize: 14, lineHeight: 1.55 }}>
      {blocks(m.content).map((b, j) => b.code
        ? <pre key={j} className="console" style={{ height: "auto", maxHeight: 360, margin: "8px 0" }}>{b.body}</pre>
        : <Fragment key={j}><span style={{ whiteSpace: "pre-wrap" }}>{b.body.replace(/^\n+|\n+$/g, "")}</span></Fragment>)}
      {m.reads && m.reads.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {m.reads.map((r) => (
            <span key={r.commandId} className="tag" data-tone={r.status === "failed" ? "danger" : r.status === "done" ? "info" : "warn"} title={r.message ?? undefined}>
              <FolderOpen size={10} /> {r.resource}{r.paths ? ` · ${r.paths.length} fichier(s)` : " · liste"} {r.status === "pending" ? "…" : r.status === "failed" ? "· échec" : ""}
            </span>
          ))}
        </div>
      )}
      {m.actions && m.actions.length > 0 && (() => {
        const pending = m.actions.map((a, j) => j).filter((j) => !m.done?.[j] && allowed.includes(kindOf(m.actions![j])));
        return (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {m.actions.map((a, j) => {
              const can = allowed.includes(kindOf(a));
              const done = m.done?.[j];
              const Icon = a.kind === "console" ? Terminal : a.kind === "player" ? UserRound : a.kind === "announce" ? Megaphone : Play;
              return (
                <button
                  key={j}
                  className="btn sm"
                  data-tone={done === "failed" ? "danger" : undefined}
                  disabled={busy || !online || !can || done === "ok"}
                  title={!can ? "Tu n'as pas la permission pour cette action" : a.kind === "player" ? a.description : undefined}
                  onClick={() => onRun([j])}
                >
                  {done === "ok" ? <Check size={13} /> : <Icon size={13} />}{a.label}{done === "failed" ? " (échec, réessayer)" : ""}
                </button>
              );
            })}
            {pending.length > 1 && <button className="btn sm primary" disabled={busy || !online} onClick={() => onRun(pending)}><Play size={13} />Tout exécuter ({pending.length})</button>}
          </div>
        );
      })()}
      {change && (
        <div style={{ marginTop: 12 }}>
          <ChangeCard change={change} online={online} busy={busy} onChange={onChange} />
          {change.status === "applied" && <button className="btn sm" style={{ marginTop: 8 }} disabled={busy} onClick={onCheck}><Sparkles size={13} />Vérifier que c&apos;est réglé</button>}
        </div>
      )}
    </div>
  );
}

function ChangeCard({ change, online, busy, onChange, collapsed = false }: {
  change: ResourceChange; online: boolean; busy: boolean; onChange: (id: number, action: "apply" | "revert" | "discard", restart?: boolean) => void; collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  const [label, tone] = CHANGE_STATUS[change.status];
  const working = change.status === "pending" || change.status === "reverting";
  return (
    <div style={{ border: "1px solid var(--line-2)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", flexWrap: "wrap", background: "var(--surface-2)" }}>
        <FileCode2 size={14} />
        <b style={{ fontSize: 13 }}>{change.resource}</b>
        <span style={{ flex: 1, minWidth: 160, fontSize: 13 }}>{change.summary}</span>
        <span className="tag" data-tone={tone}>{label}</span>
        {collapsed && <button className="btn sm" onClick={() => setOpen((o) => !o)}>{open ? "Masquer" : `Voir (${change.files.length})`}</button>}
      </div>
      {open && change.files.map((f) => <FileDiff key={f.path} path={f.path} before={f.before} after={f.after} />)}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "10px 12px", borderTop: "1px solid var(--line)" }}>
        {change.message && <span className="muted" style={{ fontSize: 12, flex: 1, minWidth: 200 }}>{change.message}</span>}
        {!change.message && <span className="muted" style={{ fontSize: 12, flex: 1, minWidth: 200 }}>{change.author ? `Par ${change.author} · ` : ""}{new Date(change.appliedAt ?? change.createdAt).toLocaleString("fr-FR")}</span>}
        {(change.status === "proposed" || change.status === "failed") && (
          <>
            <button className="btn sm primary" disabled={busy || working || !online} onClick={() => onChange(change.id, "apply", true)}><Check size={13} />Appliquer et redémarrer</button>
            <button className="btn sm" disabled={busy || working || !online} onClick={() => onChange(change.id, "apply", false)}>Appliquer sans redémarrer</button>
            {change.status === "proposed" && <button className="btn sm" disabled={busy || working} onClick={() => onChange(change.id, "discard")}><X size={13} />Ignorer</button>}
          </>
        )}
        {change.status === "applied" && <button className="btn sm" disabled={busy || !online} onClick={() => onChange(change.id, "revert")}><Undo2 size={13} />Annuler</button>}
      </div>
    </div>
  );
}

function FileDiff({ path, before, after }: { path: string; before: string | null; after: string | null }) {
  const hunks = diffHunks(lineDiff(before, after));
  const added = hunks.filter((l) => l?.type === "add").length;
  const removed = hunks.filter((l) => l?.type === "del").length;
  return (
    <div style={{ borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", gap: 10, padding: "6px 12px", fontSize: 12, alignItems: "center" }}>
        <code>{path}</code>
        {before === null && <span className="tag" data-tone="up">nouveau</span>}
        {after === null && <span className="tag" data-tone="danger">supprimé</span>}
        <span style={{ color: "var(--ok)" }}>+{added}</span>
        <span style={{ color: "var(--danger, #fb7185)" }}>−{removed}</span>
      </div>
      <pre className="console" style={{ height: "auto", maxHeight: 420, margin: 0, borderRadius: 0, border: 0, padding: "8px 0" }}>
        {hunks.map((l, i) =>
          l === null
            ? <div key={i} style={{ color: "var(--muted)", padding: "0 12px" }}>⋯</div>
            : (
              <div key={i} style={{
                padding: "0 12px", whiteSpace: "pre-wrap",
                background: l.type === "add" ? "rgba(74, 222, 128, 0.12)" : l.type === "del" ? "rgba(251, 113, 133, 0.12)" : undefined
              }}>
                <span style={{ display: "inline-block", width: 40, color: "var(--muted)", userSelect: "none" }}>{l.type === "del" ? l.a : l.b}</span>
                <span style={{ userSelect: "none", color: l.type === "add" ? "var(--ok)" : l.type === "del" ? "#fb7185" : "var(--muted)" }}>{l.type === "add" ? "+ " : l.type === "del" ? "− " : "  "}</span>
                {l.text}
              </div>
            )
        )}
      </pre>
    </div>
  );
}
