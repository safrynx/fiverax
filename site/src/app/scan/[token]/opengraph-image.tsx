import { ImageResponse } from "next/og";
import { getPublicScan } from "@/lib/external-scan";
import { gradeOf } from "@/lib/external-scan-shared";

/**
 * The picture Discord, X or WhatsApp show when a report link is shared: the grade, the score and the problems found.
 * Rendered with the font bundled in next/og (no network at build or request time). Never shows player data.
 */

export const runtime = "nodejs";
export const alt = "Note de sécurité d'un serveur FiveM, par Fiverax";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const tier = (score: number) => (score >= 80 ? "#4ade80" : score >= 50 ? "#f59e3b" : "#fb7185");

export default async function Image({ params }: { params: Promise<{ token: string }> | { token: string } }) {
  const scan = await getPublicScan((await params).token).catch(() => null);
  const score = scan?.score ?? 0;
  const grade = scan ? scan.report.grade ?? gradeOf(score) : "?";
  const color = scan ? tier(score) : "#9b907b";
  const name = (scan?.name ?? "Serveur FiveM").slice(0, 48);
  const counts = scan?.counts ?? { critical: 0, high: 0, medium: 0, info: 0 };
  const exposure = scan?.report.exposure;
  const lines = [
    counts.critical ? `${counts.critical} problème${counts.critical > 1 ? "s" : ""} critique${counts.critical > 1 ? "s" : ""}` : null,
    counts.high ? `${counts.high} problème${counts.high > 1 ? "s" : ""} grave${counts.high > 1 ? "s" : ""}` : null,
    exposure?.playerIps ? `IP de ${exposure.playerIps} joueur${exposure.playerIps > 1 ? "s" : ""} exposée${exposure.playerIps > 1 ? "s" : ""}` : null,
    exposure?.exploitable.length ? `${exposure.exploitable.length} ressource${exposure.exploitable.length > 1 ? "s" : ""} ciblée${exposure.exploitable.length > 1 ? "s" : ""} par les cheats` : null
  ].filter((l): l is string => Boolean(l)).slice(0, 3);
  if (!lines.length) lines.push(scan ? "Aucun problème grave visible de l'extérieur" : "Rapport introuvable");

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "linear-gradient(135deg, #14100a 0%, #0a0805 60%)", color: "#f2ecdf" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28, color: "#d4b06a" }}>
          <div style={{ display: "flex", width: 40, height: 40, borderRadius: 10, background: "#d4b06a", color: "#1a1308", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 800 }}>F</div>
          <div style={{ display: "flex" }}>Fiverax · Scan de sécurité FiveM</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
          <div style={{ display: "flex", width: 250, height: 250, borderRadius: 48, border: `6px solid ${color}`, alignItems: "center", justifyContent: "center", fontSize: 150, fontWeight: 800, color, background: "rgba(255,255,255,0.03)" }}>{grade}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
            <div style={{ display: "flex", fontSize: 58, fontWeight: 700, lineHeight: 1.05 }}>{name}</div>
            <div style={{ display: "flex", fontSize: 36, color }}>{scan ? `${score}/100` : "—"}</div>
            {lines.map((l) => (
              <div key={l} style={{ display: "flex", fontSize: 28, color: "#9b907b" }}>• {l}</div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#9b907b" }}>Teste ton serveur gratuitement en 10 secondes, sans compte.</div>
      </div>
    ),
    size
  );
}
