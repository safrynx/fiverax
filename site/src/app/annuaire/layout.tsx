import PublicFrame from "../public-frame";

/** Public directory: same header and footer as the other public pages, with the call to server owners (acquisition). */
export default function DirectoryLayout({ children }: { children: React.ReactNode }) {
  return <PublicFrame>{children}</PublicFrame>;
}
