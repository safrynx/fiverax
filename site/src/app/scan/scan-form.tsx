"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Circle, Loader2 } from "lucide-react";
import { endpointFromListing, parseTarget, SCAN_STEPS, type ScanStepKey } from "@/lib/external-scan-shared";
import { describeApiError } from "../ui";

/**
 * The free scan's input: a cfx.re/join link or an address. The scan's steps are streamed by /api/scan and shown as
 * they end, then the report page opens. `force`: scan again even if the server was scanned minutes ago (logged in).
 */
export default function ScanForm({ initial = "", compact = false, force = false }: { initial?: string; compact?: boolean; force?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ScanStepKey[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone([]);
    const target = parseTarget(value);
    if (!target) return setError(describeApiError({ error: "invalid_target" }, 400));
    setBusy(true);
    const fail = (data: { error?: string }, status: number) => {
      setError(describeApiError(data, status));
      setBusy(false);
    };
    try {
      // A cfx.re code: first ask the official server list from the visitor's browser (as servers.fivem.net does);
      // Cfx.re often refuses the same request from the panel's hosting. Failure is fine: the panel then tries itself.
      let address: string | null = null;
      if (target.kind === "cfx") {
        address = await fetch(`https://servers-frontend.fivem.net/api/servers/single/${encodeURIComponent(target.code)}`, {
          credentials: "omit", signal: AbortSignal.timeout(5000)
        }).then((r) => (r.ok ? r.json() : null)).then(endpointFromListing).catch(() => null);
      }
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ target: address ?? value, force })
      });
      if (!res.ok || !res.body) return fail(await res.json().catch(() => ({})), res.status);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done: end, value: chunk } = await reader.read();
        if (chunk) buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as { step?: ScanStepKey; token?: string; error?: string; status?: number };
          if (msg.step) setDone((d) => (d.includes(msg.step!) ? d : [...d, msg.step!]));
          if (msg.error) return fail(msg, msg.status ?? 422);
          if (msg.token) {
            router.push(`/scan/${msg.token}`);
            return;
          }
        }
        if (end) break;
      }
      fail({ error: "unreachable" }, 422);
    } catch {
      setError("Impossible de joindre Fiverax. Réessaie.");
      setBusy(false);
    }
  }

  const current = SCAN_STEPS.find((s) => !done.includes(s.key))?.key;
  return (
    <form className="gx-form" data-compact={compact || undefined} onSubmit={submit}>
      <div className="gx-form-row">
        <input
          className="field"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="cfx.re/join/abc123  ou  51.75.12.34:30120"
          aria-label="Adresse du serveur FiveM"
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
        />
        <button className="btn primary shine" disabled={busy || !value.trim()}>
          {busy ? <><Loader2 size={16} className="gx-spin" />Analyse…</> : <>{force ? "Rescanner" : "Scanner"}<ArrowRight size={16} /></>}
        </button>
      </div>
      {busy && (
        <ol className="gx-progress-steps" aria-live="polite">
          {SCAN_STEPS.map((s) => {
            const state = done.includes(s.key) ? "done" : s.key === current ? "run" : "wait";
            return (
              <li key={s.key} data-state={state}>
                {state === "done" ? <Check size={13} /> : state === "run" ? <Loader2 size={13} className="gx-spin" /> : <Circle size={11} />}
                {s.label}
              </li>
            );
          })}
        </ol>
      )}
      {error && <p className="error" style={{ margin: "10px 0 0" }}>{error}</p>}
      {!compact && !busy && <small className="muted">Gratuit, sans compte. Seules les informations publiques du serveur sont lues (comme le navigateur de serveurs FiveM), en quelques secondes.</small>}
    </form>
  );
}
