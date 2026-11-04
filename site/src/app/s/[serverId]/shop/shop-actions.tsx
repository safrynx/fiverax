"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

/** POST /api/s/:id/shop?kind=…, with a toast on success or failure. Resolves with the answer, or null. */
export function useShopAction() {
  const { toast } = useUI();
  const paths = useServerPaths();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (kind: string, payload: unknown, success?: string, opts: { refresh?: boolean } = {}): Promise<Record<string, unknown> | null> => {
      setBusy(true);
      try {
        const res = await fetch(paths.api(`shop?kind=${kind}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(describeApiError(data, res.status), "error");
          return null;
        }
        if (success) toast(success, "ok");
        if (opts.refresh !== false) router.refresh();
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

/** Pure: "12,5" / "12.50" -> 12.5; null when not a positive amount. */
export function parseAmount(raw: string): number | null {
  const n = Number(raw.replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
