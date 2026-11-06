import { levelOf, type LevelKey } from "./protection-shared";

/**
 * The "Protégé par Fiverax" badge as an SVG image (pure). Two styles: "card" (244×56, for websites) and "flat"
 * (20 px high, like the badges of a GitHub README). A server without a level (or a badge turned off) gets a neutral
 * badge: the image never says that a server is unsafe.
 */

export type BadgeInput = { level: LevelKey; score: number | null; checkedAt: string | null } | null;

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const FONT = "Verdana,DejaVu Sans,Segoe UI,sans-serif";
const SHIELD = "M12 2 4 5v6c0 5 3.4 9.6 8 11 4.6-1.4 8-6 8-11V5l-8-3z";

function dateLabel(at: string | null): string {
  if (!at) return "";
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : `vérifié le ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** Rough text width at a font size (Verdana-like metrics), enough to size the flat badge. */
const width = (text: string, size: number) => Math.ceil([...text].reduce((w, c) => w + (/[A-ZÉ%]/.test(c) ? 0.72 : /[ .·/:]/.test(c) ? 0.34 : 0.6), 0) * size);

export function badgeSvg(input: BadgeInput, style: "card" | "flat" = "card"): string {
  const active = input && input.level !== "none";
  const level = levelOf(active ? input.level : "none");
  const color = active ? level.color : "#9b907b";
  const title = active ? `Protégé par Fiverax · ${level.label}${input.score !== null ? ` · ${input.score}/100` : ""}` : "Fiverax · vérification en cours";

  if (style === "flat") {
    const left = "Fiverax";
    const right = active ? `${level.label}${input.score !== null ? ` · ${input.score}` : ""}` : "en cours";
    const lw = width(left, 11) + 30;
    const rw = width(right, 11) + 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="20" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>`
      + `<clipPath id="r"><rect width="${lw + rw}" height="20" rx="4"/></clipPath><g clip-path="url(#r)">`
      + `<rect width="${lw}" height="20" fill="#14100a"/><rect x="${lw}" width="${rw}" height="20" fill="${color}"/></g>`
      + `<g transform="translate(5 2) scale(0.66)"><path d="${SHIELD}" fill="#d4b06a"/></g>`
      + `<g font-family="${FONT}" font-size="11" text-rendering="geometricPrecision">`
      + `<text x="22" y="14" fill="#f2ecdf">${left}</text>`
      + `<text x="${lw + 8}" y="14" fill="#1a1308" font-weight="bold">${esc(right)}</text></g></svg>`;
  }

  const sub = active ? (input.score !== null ? `${input.score}/100` : "") : "";
  const when = active ? dateLabel(input.checkedAt) : "en attente de vérification";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="244" height="56" viewBox="0 0 244 56" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e1810"/><stop offset="1" stop-color="#0a0805"/></linearGradient></defs>`
    + `<rect x="0.5" y="0.5" width="243" height="55" rx="11" fill="url(#g)" stroke="${color}" stroke-opacity="0.75"/>`
    + `<g transform="translate(12 12) scale(1.33)"><path d="${SHIELD}" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`
    + (active ? `<path d="m8.4 12.2 2.5 2.5 4.9-5.2" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>` : "")
    + `</g><g font-family="${FONT}" text-rendering="geometricPrecision">`
    + `<text x="54" y="19" font-size="8" letter-spacing="0.8" fill="#9b907b">PROTÉGÉ PAR FIVERAX</text>`
    + `<text x="54" y="36" font-size="15" font-weight="bold" fill="${active ? color : "#f2ecdf"}">${esc(active ? level.label : "Fiverax")}</text>`
    + (sub ? `<text x="232" y="36" font-size="15" font-weight="bold" text-anchor="end" fill="#f2ecdf">${esc(sub)}</text>` : "")
    + `<text x="54" y="48" font-size="7.5" fill="#9b907b">${esc(when)}</text>`
    + `</g></svg>`;
}
