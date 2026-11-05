import LibraryView, { type Search } from "../library/library-view";

export const dynamic = "force-dynamic";

export default function Page(props: { params: Promise<{ serverId: string }>; searchParams: Promise<Search> }) {
  return <LibraryView {...props} kind="map" />;
}
