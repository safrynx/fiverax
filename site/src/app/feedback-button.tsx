"use client";
import { usePathname } from "next/navigation";
import { describeApiError, useUI } from "./ui";

/** "Signaler un bug": sends a bug report / idea with the current page (and server) to the platform admins (/admin/feedback). */
export default function FeedbackButton({ className = "linkish" }: { className?: string }) {
  const { ask, toast } = useUI();
  const pathname = usePathname() ?? "/";
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const answer = await ask({
          title: "Signaler un bug ou proposer une idée",
          message: "Ton message part directement à l'équipe Fiverax, avec la page où tu es. Décris ce que tu faisais et ce qui s'est passé.",
          select: { label: "C'est…", options: [{ value: "bug", label: "Un bug" }, { value: "idea", label: "Une idée" }, { value: "question", label: "Une question" }] },
          input: { label: "Ton message", required: true, multiline: true, placeholder: "Sur la page Anticheat, le bouton … ne fait rien quand …" },
          confirmLabel: "Envoyer"
        });
        if (!answer) return;
        const serverId = /^\/s\/([a-z0-9-]+)/.exec(pathname)?.[1] ?? null;
        const res = await fetch("/api/beta?action=feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: answer.choice, message: answer.value, page: pathname.slice(0, 200), serverId })
        }).catch(() => null);
        const data = res ? await res.json().catch(() => ({})) : { error: "network" };
        if (!res?.ok) toast(res ? describeApiError(data, res.status) : "Impossible de joindre Fiverax.", "error");
        else toast("Merci ! L'équipe Fiverax a bien reçu ton message.", "ok");
      }}
    >
      Signaler un bug
    </button>
  );
}
