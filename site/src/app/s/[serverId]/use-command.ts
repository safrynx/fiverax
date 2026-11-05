"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send an action to the FiveM agent and report what became of it: the agent picks it up on its next call
 * (a few seconds), so the toast comes once it answered, or says it never did.
 */
export function useCommand() {
  const { toast } = useUI();
  const paths = useServerPaths();
  const [busy, setBusy] = useState(false);

  /** Follow a queued action until the agent answers. `useResult`: the toast shows the agent's own message. */
  const track = useCallback(
    async (id: number, success: string, useResult = false): Promise<{ ok: boolean; result: string | null }> => {
      for (let i = 0; i < 25; i++) {
        await wait(i < 5 ? 800 : 1500);
        const status = await fetch(paths.api(`command?id=${id}`)).then((r) => r.json()).catch(() => null);
        if (!status) continue;
        if (status.status === "done") {
          toast(status.result && useResult ? status.result : success, "ok");
          return { ok: true, result: status.result ?? null };
        }
        if (status.status === "failed") {
          toast(`Refusé par le serveur : ${status.result ?? "erreur inconnue"}`, "error");
          return { ok: false, result: status.result ?? null };
        }
        if (status.status === "expired" || status.status === "lost") {
          toast("Le serveur FiveM n'a pas répondu : l'action n'a peut-être pas été exécutée.", "error");
          return { ok: false, result: "Le serveur FiveM n'a pas répondu" };
        }
      }
      toast("Action envoyée, toujours en attente du serveur FiveM.", "info");
      return { ok: true, result: null };
    },
    [paths, toast]
  );
  const follow = useCallback(async (id: number, success: string, useResult = false) => (await track(id, success, useResult)).ok, [track]);

  /** Queue an action and wait for the agent: whether it worked and the agent's message. */
  const run = useCallback(
    async (kind: string, payload: Record<string, unknown>, success: string): Promise<{ ok: boolean; result: string | null }> => {
      setBusy(true);
      try {
        const res = await fetch(paths.api(`command?kind=${kind}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const message = describeApiError(data, res.status);
          toast(message, "error");
          return { ok: false, result: message };
        }
        return await track(data.id, success, kind === "resource" || kind === "game");
      } catch {
        toast("Impossible de joindre le panel.", "error");
        return { ok: false, result: "Impossible de joindre le panel" };
      } finally {
        setBusy(false);
      }
    },
    [paths, toast, track]
  );
  const send = useCallback(async (kind: string, payload: Record<string, unknown>, success: string) => (await run(kind, payload, success)).ok, [run]);

  return { send, run, follow, busy };
}

/** Poll a JSON endpoint while the page is visible (an empty url never polls). */
export function usePolling<T>(url: string, initial: T, everyMs: number): { data: T; refresh: () => void } {
  const [data, setData] = useState<T>(initial);
  const tick = useRef<() => void>(() => {});

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      clearTimeout(timer);
      if (url && document.visibilityState === "visible") {
        const next = await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (!stopped && next) setData(next as T);
      }
      if (!stopped) timer = setTimeout(load, everyMs);
    };
    tick.current = load;
    timer = setTimeout(load, everyMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [url, everyMs]);

  return { data, refresh: useCallback(() => tick.current(), []) };
}
