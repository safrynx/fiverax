import PublicFrame from "../public-frame";
import "./guides.css";

/** Tutorials: public pages (also linked from the panel's menu), inside the public header and footer. */
export default function GuidesLayout({ children }: { children: React.ReactNode }) {
  return <PublicFrame><div className="guides">{children}</div></PublicFrame>;
}
