"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";
import { BAN_CATEGORIES } from "@/lib/network-shared";

/** POST /api/s/:id/security?kind=…, with a toast on success or failure. Resolves with the answer, or null. */
export function useSecurityAction() {
  const { toast } = useUI();
  const paths = useServerPaths();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (kind: string, payload: unknown, success?: string): Promise<Record<string, unknown> | null> => {
      setBusy(true);
      try {
        const res = await fetch(paths.api(`security?kind=${kind}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(describeApiError(data, res.status), "error");
          return null;
        }
        if (success) toast(success, "ok");
        router.refresh();
        return data;
      } catch {
        toast("Impossible de joindre le panel.", "error");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [paths, router, toast]
  );

  return { run, busy };
}

/** Ask for a reason and a duration, then ban the player. */
export function useBanDialog() {
  const { ask } = useUI();
  const { run, busy } = useSecurityAction();
  const ban = useCallback(
    async (playerId: number, name: string): Promise<boolean> => {
      const answer = await ask({
        title: `Bannir ${name}`,
        message: "Le ban porte sur sa license Rockstar, ses comptes liés (Discord, Steam…) et ses identifiants matériels. Durée : ajoute « 3j », « 12h » ou « 1sem » à la fin de la raison (définitif sinon).",
        confirmLabel: "Bannir",
        danger: true,
        input: { label: "Raison", required: true, placeholder: "Ex. : cheat (menu visible), 3j" },
        select: { label: "Catégorie", options: BAN_CATEGORIES.map((c) => ({ value: c.key, label: `${c.label} — ${c.hint}` })), initial: "cheat" },
        check: {
          label: "Partager avec le réseau Fiverax",
          hint: "Les autres serveurs du réseau voient ce ban (pseudo, raison, catégorie), jamais ses identifiants. Sans effet si ton serveur n'est pas membre.",
          initial: true
        }
      });
      if (!answer) return false;
      const { reason, hours } = parseBanInput(answer.value);
      const payload = { playerId, reason, hours, category: answer.choice ?? "other", shared: answer.checked !== false };
      return Boolean(await run("ban", payload, hours ? `${name} banni pour ${formatHours(hours)}` : `${name} banni définitivement`));
    },
    [ask, run]
  );
  return { ban, busy };
}

/** Pure: "cheat, 3j" -> { reason: "cheat", hours: 72 }. Units: h, j/d, sem/w, m (mois). No duration: permanent. */
export function parseBanInput(raw: string): { reason: string; hours: number | null } {
  const match = /[,\s]+(\d{1,4})\s*(h|j|d|sem|w|mois|m)\s*$/i.exec(raw.trim());
  if (!match) return { reason: raw.trim(), hours: null };
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  const hours = unit === "h" ? n : unit === "j" || unit === "d" ? n * 24 : unit === "sem" || unit === "w" ? n * 168 : n * 720;
  const reason = raw.trim().slice(0, match.index).trim() || "Ban";
  return { reason, hours: hours > 0 ? hours : null };
}

export function formatHours(hours: number): string {
  if (hours % 720 === 0) return `${hours / 720} mois`;
  if (hours % 168 === 0) return `${hours / 168} semaine${hours / 168 > 1 ? "s" : ""}`;
  if (hours % 24 === 0) return `${hours / 24} jour${hours / 24 > 1 ? "s" : ""}`;
  return `${hours} h`;
}

/** Re-render the server page every few seconds while it is visible (new detections, incidents…). */
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
