import Link from "next/link";
import { BadgeCheck, Ban, BookOpen, PanelsTopLeft, Bot, Crown, Gift, Globe, BadgePercent, Library, Network, WandSparkles, Boxes, CreditCard, ShoppingBag, Store, UserSearch, ChevronsUpDown, FileCode2, Contact, KeyRound, LayoutDashboard, type LucideIcon, Palette, Map as MapIcon, Radio, Radar, ScanSearch, ScrollText, Server as ServerIcon, Settings, ShieldAlert, ShieldCheck, Siren, TrendingUp, Users } from "lucide-react";
import { can, isOwner } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/config";
import { getPlatformSettings } from "@/lib/platform";
import type { Server } from "@/lib/servers";
import type { Identity, SessionUser } from "@/lib/types";
import Avatar from "./avatar";
import { Mark } from "./brand";
import FeedbackButton from "./feedback-button";
import LogoutButton from "./logout-button";
import { GuildIcon } from "./new-server-form";

export type NavKey = "dashboard" | "live" | "map" | "players" | "reports" | "server" | "assistant" | "security" | "anticheat" | "audit" | "protection" | "bans" | "antiraid" | "studio_ui" | "studio_script" | "studio_map" | "shop" | "shop_payments" | "shop_catalog" | "shop_promos" | "shop_customers" | "shop_settings" | "store_creator" | "network" | "directory" | "portal" | "referral" | "lib_ui" | "lib_script" | "lib_map" | "staff" | "report" | "logs" | "admin" | "bot" | "settings";

export type NavItem = { href: string; label: string; icon: LucideIcon; active?: boolean };
export type NavSection = { label: string; items: NavItem[] };

type Props = { user: SessionUser; server: Server; active: NavKey; children: React.ReactNode };

/** Layout of the pages of one server: its navigation, the server switcher, the logged-in user. */
export default function Shell({ user, server, active, children }: Props) {
  const base = `/s/${server.id}`;
  const item = (key: NavKey, href: string, label: string, icon: LucideIcon): NavItem => ({ href, label, icon, active: key === active });
  const fivem = [
    ...(can(user, "view_live")
      ? [
          item("live", `${base}/live`, "En direct", Radio),
          item("map", `${base}/map`, "Carte & vocal", MapIcon),
          item("players", `${base}/players`, "Joueurs", Contact)
        ]
      : []),
    ...(can(user, "reports") || can(user, "ban") ? [item("reports", `${base}/reports`, "Reports & replays", Siren)] : []),
    ...(can(user, "resources") || can(user, "console") ? [item("server", `${base}/server`, "Ressources & console", ServerIcon)] : []),
    ...(can(user, "console") ? [item("assistant", `${base}/assistant`, "Assistant IA", Bot)] : [])
  ];
  const shopItems = [
    item("shop", `${base}/shop`, "Ventes", Store),
    item("shop_payments", `${base}/shop/payments`, "Paiements", CreditCard),
    item("shop_catalog", `${base}/shop/catalog`, "Catalogue", ShoppingBag),
    item("shop_promos", `${base}/shop/promos`, "Promotions", BadgePercent),
    item("shop_customers", `${base}/shop/customers`, "Clients", UserSearch),
    ...(isOwner(user) ? [item("shop_settings", `${base}/shop/settings`, "Réglages boutique", Settings)] : [])
  ];
  const sections: NavSection[] = [
    {
      label: "Pilotage",
      items: [
        item("dashboard", base, "Accueil", LayoutDashboard),
        ...(can(user, "view_logs") ? [item("logs", `${base}/logs`, "Logs", ScrollText)] : [])
      ]
    },
    ...(fivem.length ? [{ label: "Serveur FiveM", items: fivem }] : []),
    ...(can(user, "view_security")
      ? [{
          label: "Sécurité",
          items: [
            item("security", `${base}/security`, "Centre de sécurité", Radar),
            item("anticheat", `${base}/anticheat`, "Anticheat", ShieldAlert),
            item("audit", `${base}/scanner`, "Scanner", ScanSearch),
            item("protection", `${base}/protection`, "Protection & badge", BadgeCheck),
            item("bans", `${base}/bans`, "Bans", Ban),
            item("antiraid", `${base}/antiraid`, "Anti-raid Discord", ShieldCheck)
          ]
        }]
      : []),
    ...(can(user, "studio")
      ? [{
          label: "Studio IA",
          items: [
            item("studio_ui", `${base}/studio/ui`, "UI Creator", Palette),
            item("studio_script", `${base}/studio/script`, "Script Creator", FileCode2),
            item("studio_map", `${base}/studio/map`, "Mapping Creator", Boxes)
          ]
        }]
      : []),
    ...(can(user, "view_security") || can(user, "studio") || can(user, "directory_edit") || can(user, "portal_edit") || isOwner(user)
      ? [{
          label: "Réseau Fiverax",
          items: [
            ...(can(user, "directory_edit") ? [item("directory", `${base}/directory`, "Fiche annuaire", Globe)] : []),
            ...(can(user, "portal_edit") ? [item("portal", `${base}/portal`, "Portail joueurs", PanelsTopLeft)] : []),
            ...(isOwner(user) ? [item("referral", `${base}/referral`, "Parrainage", Gift)] : []),
            ...(can(user, "view_security") ? [item("network", `${base}/network`, "Bans partagés", Network)] : []),
            ...(can(user, "studio")
              ? [
                  item("lib_ui", `${base}/ui`, "UI", Palette),
                  item("lib_script", `${base}/scripts`, "Scripts", FileCode2),
                  item("lib_map", `${base}/mappings`, "Mappings", Boxes)
                ]
              : [])
          ]
        }]
      : []),
    ...(can(user, "shop_view") || can(user, "store_edit")
      ? [{
          label: "Boutique Tebex",
          items: [
            ...(can(user, "store_edit") ? [item("store_creator", `${base}/store`, "Store Creator", WandSparkles)] : []),
            ...(can(user, "shop_view") ? shopItems : [])
          ]
        }]
      : []),
    {
      label: "Staff",
      items: [
        item("staff", `${base}/staff`, "Équipe", Users),
        ...(can(user, "view_report") ? [item("report", `${base}/report`, "Bilan hebdo", TrendingUp)] : [])
      ]
    },
    ...(isOwner(user)
      ? [{ label: "Administration", items: [item("admin", `${base}/admin`, "Accès & rôles", KeyRound), item("bot", `${base}/bot`, "Bot Discord", Bot), item("settings", `${base}/settings`, "Configuration", Settings)] }]
      : [])
  ];

  return <Frame identity={user} server={server} sections={sections}>{children}</Frame>;
}

type FrameProps = {
  identity: Identity;
  /** The server being managed (shown in the switcher), or none on the server list. */
  server?: Server;
  sections: NavSection[];
  children: React.ReactNode;
};

/** The platform's announcement (/admin/settings), and for the admins a reminder that maintenance is on. */
async function PlatformNotice({ admin }: { admin: boolean }) {
  const { announcement, maintenance } = await getPlatformSettings();
  return (
    <>
      {admin && maintenance.active && <div className="banner" data-tone="danger">Maintenance active : seuls les administrateurs de la plateforme ont accès au panel.</div>}
      {announcement.active && announcement.text && <div className="banner" data-tone={announcement.tone}>{announcement.text}</div>}
    </>
  );
}

/** Bare layout (sidebar, mobile top bar, content), shared by the server pages, the server list and /admin. */
export function Frame({ identity, server, sections: given, children }: FrameProps) {
  const admin = isPlatformOwner(identity.discordId);
  // Platform admins reach /admin from anywhere (the admin pages list their own sections). Everyone gets the tutorials.
  const sections = [
    ...given,
    ...(admin && !given.some((s) => s.items.some((i) => i.href.startsWith("/admin"))) ? [{ label: "Plateforme", items: [{ href: "/admin", label: "Administration", icon: Crown }] }] : []),
    { label: "Aide", items: [{ href: "/guides", label: "Tutoriels", icon: BookOpen }] }
  ];
  const items = sections.flatMap((s) => s.items);
  return (
    <div>
      <aside className="side">
        <Link href="/servers" className="brand"><Mark size={30} /><b>Fiverax</b></Link>

        {server && (
          <Link href="/servers" className="switcher" title="Changer de serveur">
            <GuildIcon url={server.iconUrl} name={server.name} size={34} />
            <div><small>Serveur</small><b>{server.name}</b></div>
            <ChevronsUpDown size={15} />
          </Link>
        )}

        <nav className="nav">
          {sections.map((section) => (
            <div key={section.label}>
              <div className="nav-label">{section.label}</div>
              {section.items.map((it) => (
                <Link key={it.href} href={it.href} data-active={Boolean(it.active)}>
                  <it.icon size={17} strokeWidth={1.8} />{it.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="me">
          <Avatar url={identity.avatarUrl} name={identity.username} size={34} />
          <div><b>{identity.username}</b><span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><LogoutButton /><FeedbackButton /></span></div>
        </div>
      </aside>

      <div className="topbar">
        <Link href="/servers" aria-label="Mes serveurs"><Mark size={26} /></Link>
        {items.map((it) => <Link key={it.href} href={it.href} data-active={Boolean(it.active)}>{it.label}</Link>)}
        {server && <Link href="/servers">Serveurs</Link>}
        <FeedbackButton className="topbar-btn" />
      </div>

      <main className="main"><div className="content"><PlatformNotice admin={admin} />{children}</div></main>
    </div>
  );
}

/** Page heading: small kicker, big display title, optional description, tutorial link (`help`) and right-hand actions. */
export function PageHead({ kicker, title, children, actions, help }: { kicker: string; title: string; children?: React.ReactNode; actions?: React.ReactNode; help?: string }) {
  return (
    <div className="head rise">
      <div>
        <div className="eyebrow">{kicker}</div>
        <h1 className="h1">{title}</h1>
        {(children || help) && <p>{children}{help && <>{children ? " " : ""}<Link href={help} className="linkish" style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}><BookOpen size={12} />Tutoriel</Link></>}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}
