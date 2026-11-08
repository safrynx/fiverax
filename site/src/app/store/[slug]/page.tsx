import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, getSessionUser } from "@/lib/auth";
import { getPublicStore } from "@/lib/store";
import StoreView from "../store-view";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<{ draft?: string }> };

/** The draft is shown only to the server's staff allowed to edit the store. */
async function load({ params, searchParams }: Params) {
  const { slug } = await params;
  const wantsDraft = (await searchParams).draft === "1";
  const published = await getPublicStore(slug);
  if (!wantsDraft) return published;
  const any = published ?? (await getPublicStore(slug, { draft: true }));
  if (!any) return null;
  const user = await getSessionUser(any.server.id);
  return user && can(user, "store_edit") ? getPublicStore(slug, { draft: true }) : published;
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const store = await load(props);
  if (!store) return { title: "Boutique introuvable" };
  const d = store.design;
  const title = d.seo.title || `Boutique ${d.brand.name}`;
  const description = d.seo.description || d.brand.tagline || `Soutiens ${d.brand.name} et débloque tes avantages en jeu.`;
  const image = d.seo.image || d.brand.logo || undefined;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/store/${store.slug}` },
    robots: store.draft ? { index: false, follow: false } : undefined,
    openGraph: { title, description, type: "website", images: image ? [image] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title, description },
    icons: d.brand.logo ? { icon: d.brand.logo } : undefined
  };
}

export default async function StorePage(props: Params) {
  const store = await load(props);
  if (!store) notFound();
  return (
    <>
      {store.draft && <div className="sf-draft-flag">Brouillon : visible par ton équipe uniquement</div>}
      <StoreView design={store.design} data={store.data} slug={store.slug} mode="live" />
    </>
  );
}
