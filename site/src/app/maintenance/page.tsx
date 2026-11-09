import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlatformSettings } from "@/lib/platform";
import { Mark } from "../brand";
import LogoutButton from "../logout-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Maintenance", robots: { index: false, follow: false } };

/** Where the panel sends everyone but the platform admins while maintenance is on (/admin/settings). */
export default async function MaintenancePage() {
  const { maintenance } = await getPlatformSettings();
  if (!maintenance.active) redirect("/servers");
  return (
    <main className="lost">
      <div>
        <Mark size={72} className="lost-mark" />
        {/* The 404 style is sized for three characters: a smaller scale keeps the word inside a phone screen. */}
        <b className="gold" style={{ fontSize: "clamp(38px, 10vw, 104px)", letterSpacing: "-0.04em" }}>Maintenance</b>
        <p className="muted" style={{ margin: "8px auto 26px", maxWidth: 460 }}>
          {maintenance.message || "Le panel est en maintenance pour quelques minutes. Les serveurs FiveM, le bot et les pages publiques continuent de fonctionner."}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", alignItems: "center" }}>
          <Link href="/maintenance" className="btn primary">Réessayer</Link>
          <Link href="/annuaire" className="btn">Annuaire</Link>
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
