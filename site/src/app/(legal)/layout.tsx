import PublicFrame from "../public-frame";
import "./legal.css";

/** Legal notice, privacy policy, terms and contact: plain text pages inside the public header and footer. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <PublicFrame><article className="legal">{children}</article></PublicFrame>;
}
