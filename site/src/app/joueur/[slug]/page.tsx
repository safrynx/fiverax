import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { can, getIdentity, getSessionUser } from "@/lib/auth";
import { getPublicPortal } from "@/lib/portal-site";
import PortalView from "../portal-view";
import "../portal.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> };

/** A server's player portal; `?preview=1` shows the draft to its staff (permission portal_edit). */
async function load({ params, searchParams }: Props) {
  const { slug } = await params;
  const identity = await getIdentity();
  const viewer = identity ? { discordId: identity.discordId, username: identity.username, avatarUrl: identity.avatarUrl ?? null } : null;
  if ((await searchParams).preview === "1" && identity) {
    const draft = await getPublicPortal(slug, viewer, { draft: true });
    const user = draft ? await getSessionUser(draft.server.id) : null;
    if (draft && user && can(user, "portal_edit")) return draft;
  }
  return getPublicPortal(slug, viewer);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const data = await load(props);
  if (!data) return { title: "Espace joueurs introuvable" };
  const description = data.design.tagline || `Annonces, événements, candidatures et giveaways de ${data.ctx.serverName}.`;
  return {
    title: { absolute: `${data.design.title} · Espace joueurs · Fiverax` },
    description,
    robots: data.draft ? { index: false, follow: false } : undefined,
    openGraph: { title: data.design.title, description, images: data.design.banner ? [data.design.banner] : undefined }
  };
}

export default async function ServerPortalPage(props: Props) {
  const data = await load(props);
  if (!data) notFound();
  return (
    <>
      <div style={{ marginTop: 20 }}>
        <Link href="/joueur" className="linkish" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}><ArrowLeft size={12} />Mon espace joueur</Link>
      </div>
      {data.draft && <div className="banner" style={{ marginTop: 12 }}><b>Brouillon :</b> seul ton staff voit cette version. Publie-la depuis le panel.</div>}
      <PortalView design={data.design} ctx={data.ctx} />
    </>
  );
}
