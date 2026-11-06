"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { endpointFromListing, parseTarget } from "@/lib/external-scan-shared";
import { describeApiError } from "../ui";

/** The free scan's input: a cfx.re/join link or an address, then the report page. */
export default function ScanForm({ initial = "", compact = false }: { initial?: string; compact?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const target = parseTarget(value);
    if (!target) return setError(describeApiError({ error: "invalid_target" }, 400));
    setBusy(true);
    try {
      // A cfx.re code: first ask the official server list from the visitor's browser (as servers.fivem.net does);
      // Cfx.re often refuses the same request from the panel's hosting. Failure is fine: the panel then tries itself.
      let address: string | null = null;
      if (target.kind === "cfx") {
        address = await fetch(`https://servers-frontend.fivem.net/api/servers/single/${encodeURIComponent(target.code)}`, {
          credentials: "omit", signal: AbortSignal.timeout(5000)
        }).then((r) => (r.ok ? r.json() : null)).then(endpointFromListing).catch(() => null);
      }
      const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: address ?? value }) });
      const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setError(describeApiError(data, res.status));
        setBusy(false);
        return;
      }
      router.push(`/scan/${data.token}`);
    } catch {
      setError("Impossible de joindre Fiverax. Réessaie.");
      setBusy(false);
    }
  }

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
          {busy ? <><Loader2 size={16} className="gx-spin" />Analyse…</> : <>Scanner<ArrowRight size={16} /></>}
        </button>
      </div>
      {error && <p className="error" style={{ margin: "10px 0 0" }}>{error}</p>}
      {!compact && <small className="muted">Gratuit, sans compte. Seules les informations publiques du serveur sont lues (comme le navigateur de serveurs FiveM), en quelques secondes.</small>}
    </form>
  );
}
