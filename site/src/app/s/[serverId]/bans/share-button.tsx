"use client";
import { Lock, Network } from "lucide-react";
import { useSecurityAction } from "../security-actions";

/** Share a ban with the Fiverax network, or keep it on this server. */
export default function ShareButton({ banId, shared, name }: { banId: number; shared: boolean; name: string }) {
  const { run, busy } = useSecurityAction();
  return (
    <button
      type="button"
      className="ibtn"
      disabled={busy}
      title={shared ? "Partagé avec le réseau : cliquer pour le garder sur ce serveur" : "Privé : cliquer pour le partager avec le réseau"}
      onClick={() => run("ban_sharing", { banId, shared: !shared }, shared ? `Ban de ${name} gardé sur ce serveur` : `Ban de ${name} partagé avec le réseau`)}
    >
      {shared ? <Network size={13} /> : <Lock size={13} />}
    </button>
  );
}
