"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** A small "copy" button for a snippet (embed code, link, server.cfg block). Works on public pages too. */
export default function CopyText({ text, label = "Copier", className = "btn sm" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          window.prompt("Copie ce texte :", text);
        }
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}{done ? "Copié" : label}
    </button>
  );
}
