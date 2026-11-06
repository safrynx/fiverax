import PublicFrame from "../public-frame";

export default function ProtectionLayout({ children }: { children: React.ReactNode }) {
  return <PublicFrame>{children}</PublicFrame>;
}
