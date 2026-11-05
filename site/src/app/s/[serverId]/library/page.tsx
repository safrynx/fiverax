import { redirect } from "next/navigation";
import { isCreationKind } from "@/lib/studio-shared";
import { LIB_PAGES } from "./library-view";

/** Legacy URL: the library is split into /ui, /scripts and /mappings. */
export default async function LibraryRedirect({ params, searchParams }: { params: Promise<{ serverId: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { serverId } = await params;
  const { kind } = await searchParams;
  redirect(`/s/${serverId}/${LIB_PAGES[kind && isCreationKind(kind) ? kind : "ui"].slug}`);
}
