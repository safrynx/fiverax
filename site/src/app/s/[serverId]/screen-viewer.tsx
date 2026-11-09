"use client";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { Camera, Maximize2, X } from "lucide-react";
import { useServerPaths, useUI } from "@/app/ui";
import { useCommand } from "./use-command";
import { screenStatus, useLiveScreen } from "./use-live-screen";

type Props = { target: number; name: string; onClose: () => void };

/**
 * A player's screen, live: the agent streams screenshots while this window is open (about one per second, through
 * screenshot-basic). The agent stops by itself once nobody has read a frame for 15 s.
 */
export default function ScreenViewer({ target, name, onClose }: Props) {
  const { serverId } = useServerPaths();
  const { toast } = useUI();
  const { send, busy } = useCommand();
  const screen = useLiveScreen(serverId, target);
  const box = useRef<HTMLDivElement>(null);
  const live = Boolean(screen.src && !screen.error && (screen.age ?? 99) <= 8);

  return createPortal(
    <div className="veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog shot-dialog" ref={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Écran de {name} <span className="muted">#{target}</span></h3>
            <small className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span className={`dot ${live ? "on" : ""}`} />{screenStatus(screen)}
            </small>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="ibtn" title="Plein écran" onClick={() => box.current?.requestFullscreen?.().catch(() => toast("Plein écran refusé par le navigateur", "error"))}><Maximize2 size={14} /></button>
            <button className="ibtn" title="Fermer" onClick={onClose}><X size={14} /></button>
          </div>
        </div>
        <div className="screen-frame">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {screen.src ? <img src={screen.src} alt={`Écran de ${name}`} /> : <div className="screen-wait">{screen.error ?? (screen.slow ? screenStatus(screen) : "En attente de la première image…")}</div>}
        </div>
        <div className="actions">
          <span className="muted" style={{ fontSize: 12, marginRight: "auto" }}>Le flux s&apos;arrête quelques secondes après la fermeture de cette fenêtre. Rien n&apos;est enregistré.</span>
          <button className="btn" disabled={busy || Boolean(screen.error)} onClick={() => send("screenshot", { target }, "Capture gardée et envoyée à l'analyse IA")}><Camera size={15} />Garder une capture</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
