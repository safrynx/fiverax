import { CircleAlert, Lightbulb } from "lucide-react";
import CopyText from "../copy-text";

/** Building blocks of the tutorials (/guides). */

/** A numbered step: its number comes from the CSS counter of .guide-body. */
export function Step({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="guide-step" id={id}>
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

/** A block to paste (server.cfg lines, IDs…), with a copy button. */
export function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="guide-code">
      <div className="guide-code-head"><span>{label ?? "À copier"}</span><CopyText text={children} /></div>
      <pre>{children}</pre>
    </div>
  );
}

export function Tip({ children }: { children: React.ReactNode }) {
  return <aside className="guide-note" data-tone="tip"><Lightbulb size={16} /><div>{children}</div></aside>;
}

export function Warn({ children }: { children: React.ReactNode }) {
  return <aside className="guide-note" data-tone="warn"><CircleAlert size={16} /><div>{children}</div></aside>;
}

/** Where to click in the panel: « Sécurité › Anticheat › Réglages ». */
export function Path({ children }: { children: string }) {
  return <span className="guide-path">{children.split(">").map((part, i) => <span key={i}>{i > 0 && <i>›</i>}{part.trim()}</span>)}</span>;
}
