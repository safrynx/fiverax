import type { Metadata } from "next";

/** The staff panel of a server: private, never in search results. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function ServerPanelLayout({ children }: { children: React.ReactNode }) {
  return children;
}
