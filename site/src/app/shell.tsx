import Link from "next/link";
import { Ban, Bot, Globe, BadgePercent, Library, Network, WandSparkles, Boxes, CreditCard, ShoppingBag, Store, UserSearch, ChevronsUpDown, FileCode2, Contact, KeyRound, LayoutDashboard, type LucideIcon, Palette, Map as MapIcon, Radio, ScanSearch, ScrollText, Server as ServerIcon, Settings, ShieldAlert, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { can, isOwner } from "@/lib/auth";
import type { Server } from "@/lib/servers";
import type { Identity, SessionUser } from "@/lib/types";
import Avatar from "./avatar";
import { Mark } from "./brand";
import LogoutButton from "./logout-button";
import { GuildIcon } from "./new-server-form";

export type NavKey = "dashboard" | "live" | "map" | "players" | "server" | "assistant" | "anticheat" | "audit" | "bans" | "antiraid" | "studio_ui" | "studio_script" | "studio_map" | "shop" | "shop_payments" | "shop_catalog" | "shop_promos" | "shop_customers" | "shop_settings" | "store_creator" | "network" | "directory" | "lib_ui" | "lib_script" | "lib_map" | "staff" | "report" | "logs" | "admin" | "settings";

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
            item("anticheat", `${base}/anticheat`, "Anticheat", ShieldAlert),
            item("audit", `${base}/scanner`, "Scanner", ScanSearch),
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
    ...(can(user, "view_security") || can(user, "studio") || can(user, "directory_edit")
      ? [{
          label: "Réseau Fiverax",
          items: [
            ...(can(user, "directory_edit") ? [item("directory", `${base}/directory`, "Fiche annuaire", Globe)] : []),
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
      ? [{ label: "Administration", items: [item("admin", `${base}/admin`, "Accès & rôles", KeyRound), item("settings", `${base}/settings`, "Configuration", Settings)] }]
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

/** Bare layout (sidebar, mobile top bar, content), shared by the server pages and the server list. */
export function Frame({ identity, server, sections, children }: FrameProps) {
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
          <div><b>{identity.username}</b><LogoutButton /></div>
        </div>
      </aside>

      <div className="topbar">
        <Link href="/servers" aria-label="Mes serveurs"><Mark size={26} /></Link>
        {items.map((it) => <Link key={it.href} href={it.href} data-active={Boolean(it.active)}>{it.label}</Link>)}
        {server && <Link href="/servers">Serveurs</Link>}
      </div>

      <main className="main"><div className="content">{children}</div></main>
    </div>
  );
}

/** Page heading: small kicker, big display title, optional description and right-hand actions. */
export function PageHead({ kicker, title, children, actions }: { kicker: string; title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="head rise">
      <div><div className="eyebrow">{kicker}</div><h1 className="h1">{title}</h1>{children && <p>{children}</p>}</div>
      {actions && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}
