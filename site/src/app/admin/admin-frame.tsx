import Link from "next/link";
import { Activity, Bot, Bug, Gavel, Handshake, LayoutDashboard, ScrollText, Server as ServerIcon, Settings2, Users } from "lucide-react";
import type { Identity } from "@/lib/types";
import { Frame, type NavItem } from "../shell";
import "./admin.css";

export type AdminNav = "overview" | "servers" | "users" | "beta" | "feedback" | "moderation" | "bot" | "settings" | "journal" | "system";

/** Layout of the platform administration (/admin): its own navigation, the usual frame. */
export default function AdminFrame({ identity, active, children }: { identity: Identity; active: AdminNav; children: React.ReactNode }) {
  const item = (key: AdminNav, href: string, label: string, icon: NavItem["icon"]): NavItem => ({ href, label, icon, active: key === active });
  return (
    <Frame
      identity={identity}
      sections={[
        {
          label: "Administration",
          items: [
            item("overview", "/admin", "Vue d'ensemble", LayoutDashboard),
            item("servers", "/admin/servers", "Serveurs", ServerIcon),
            item("users", "/admin/users", "Comptes", Users),
            item("beta", "/admin/beta", "Bêta & partenaires", Handshake),
            item("feedback", "/admin/feedback", "Retours", Bug),
            item("moderation", "/admin/moderation", "Modération", Gavel)
          ]
        },
        {
          label: "Plateforme",
          items: [
            item("bot", "/admin/bot", "Bot Discord", Bot),
            item("settings", "/admin/settings", "Réglages", Settings2),
            item("journal", "/admin/journal", "Journal", ScrollText),
            item("system", "/admin/system", "Système", Activity)
          ]
        },
        { label: "Espace", items: [{ href: "/servers", label: "Mes serveurs", icon: ServerIcon }] }
      ]}
    >
      {children}
    </Frame>
  );
}

/** "YYYY-MM-DD HH:MM:SS" (SQLite, UTC) or ISO -> "21/10/2026" in Paris time; "—" when empty. */
export function formatDay(raw: string | null | undefined): string {
  if (!raw) return "—";
  // A bare day ("2026-11-09", UTC days of the AI usage): noon UTC is the same day in Paris.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** "il y a 3 min" style, for last activity. */
export function formatAgo(raw: string | null | undefined, now = Date.now()): string {
  if (!raw) return "jamais";
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (!Number.isFinite(s)) return "—";
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86_400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86_400)} j`;
}

/** Previous / next links of a paged list. */
export function Pager({ page, pages, link }: { page: number; pages: number; link: (p: number) => string }) {
  if (pages <= 1) return null;
  return (
    <div className="pill-tabs" style={{ marginTop: 22 }}>
      {page > 1 && <Link href={link(page - 1)}>← Précédent</Link>}
      <span className="muted" style={{ padding: "6px 10px" }}>Page {page} / {pages}</span>
      {page < pages && <Link href={link(page + 1)}>Suivant →</Link>}
    </div>
  );
}
