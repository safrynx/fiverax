"use client";
import { useEffect, useState } from "react";
import { describeApiError } from "@/app/ui";

export type LiveScreen = {
  /** Object URL of the latest frame (null until the first one). */
  src: string | null;
  frameAt: number | null;
  /** Seconds since the last frame (null before the first). */
  age: number | null;
  error: string | null;
  /** True while no frame came for a while after asking: screenshot-basic missing or blocked, player loading… */
  slow: boolean;
};

/**
 * A player's screen, live: asks the agent to stream (about one image per second through screenshot-basic) and polls
 * the latest frame while mounted. The agent stops by itself once nobody read a frame for 15 s. Shared by the
 * screen window (screen-viewer.tsx) and the screen wall of the anticheat page.
 */
export function useLiveScreen(serverId: string, target: number, opts: { paused?: boolean } = {}): LiveScreen {
  const [src, setSrc] = useState<string | null>(null);
  const [frameAt, setFrameAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  /** When this screen was first asked for: the "nothing comes" hint counts from there, not from each new ask. */
  const [firstAskedAt, setFirstAskedAt] = useState<number | null>(null);
  const paused = Boolean(opts.paused);

  useEffect(() => {
    if (paused) return;
    let stopped = false;
    let url: string | null = null;
    const api = `/api/s/${serverId}/screen/${target}`;
    // Ask the agent to stream; asked again whenever the image stops moving (agent restarted, frame lost…).
    let requestedAt = 0;
    let lastFrame = 0;
    setFirstAskedAt(Date.now());
    const request = async (): Promise<boolean> => {
      requestedAt = Date.now();
      const res = await fetch(api, { method: "POST" }).catch(() => null);
      if (res?.ok) return true;
      const data = res ? await res.json().catch(() => ({})) : { error: "network" };
      if (!stopped) setError(res ? describeApiError(data, res.status) : "Impossible de joindre le panel.");
      return false;
    };
    (async () => {
      if (!(await request())) return;
      while (!stopped) {
        const frame = await fetch(`${api}?t=${Date.now()}`, { cache: "no-store" }).catch(() => null);
        if (frame?.status === 200) {
          const at = new Date(frame.headers.get("X-Frame-At") ?? Date.now()).getTime();
          const blob = await frame.blob();
          if (at !== lastFrame) {
            lastFrame = at;
            const next = URL.createObjectURL(blob);
            if (url) URL.revokeObjectURL(url);
            url = next;
            if (!stopped) {
              setSrc(next);
              setFrameAt(at);
            }
          }
        } else {
          await frame?.body?.cancel().catch(() => undefined);
        }
        if (Date.now() - Math.max(lastFrame, requestedAt) > 6000 && Date.now() - requestedAt > 8000 && !stopped) {
          if (!(await request())) return;
          setError(null);
        }
        setNow(Date.now());
        await new Promise((r) => setTimeout(r, document.visibilityState === "visible" ? 700 : 3000));
      }
    })();
    return () => {
      stopped = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [serverId, target, paused]);

  const age = frameAt ? Math.max(0, Math.round((now - frameAt) / 1000)) : null;
  const slow = !error && !src && firstAskedAt !== null && now - firstAskedAt > 12_000;
  return { src, frameAt, age, error, slow };
}

/** The line under a screen: live, frozen, waiting, or why it does not come. */
export function screenStatus(s: LiveScreen): string {
  if (s.error) return s.error;
  if (s.src) return s.age !== null && s.age > 8 ? `Image figée depuis ${s.age} s (joueur parti ou screenshot-basic bloqué ?)` : `En direct · il y a ${s.age ?? 0} s`;
  if (s.slow) return "Rien ne vient : vérifie que screenshot-basic est démarré sur le serveur FiveM.";
  return "Connexion à l'écran du joueur…";
}
