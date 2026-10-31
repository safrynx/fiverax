"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Copy, MapPin } from "lucide-react";
import { BLOCK_DEFS, TOOLBOX } from "@/lib/studio-blocks";
import { useUI } from "@/app/ui";

type Player = { id: number; name: string; pos: [number, number, number] };
/**
 * Blocks to snap together, like Scratch (Blockly, "zelos" renderer). `loadKey` changes when the workspace is replaced
 * from outside (restore, mode switch): the blocks are reloaded from `value`. Edits are sent back with `onChange`.
 */
type Props = { value: unknown; onChange: (workspace: unknown) => void; loadKey: number; warnings: string[]; players: Player[] };

type BlocklyModule = typeof import("blockly");
let defined = false;

export default function BlockEditor({ value, onChange, loadKey, warnings, players }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ws = useRef<import("blockly").WorkspaceSvg | null>(null);
  const lib = useRef<BlocklyModule | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const loadedAt = useRef(0);
  const [ready, setReady] = useState(false);
  const { toast } = useUI();

  // Create the workspace once (Blockly needs the DOM, so it is loaded here).
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: ResizeObserver | undefined;
    void (async () => {
      const [Blockly, fr] = await Promise.all([import("blockly"), import("blockly/msg/fr")]);
      if (disposed || !host.current) return;
      lib.current = Blockly;
      Blockly.setLocale(fr as unknown as Parameters<typeof Blockly.setLocale>[0]);
      if (!defined) {
        Blockly.common.defineBlocksWithJsonArray(BLOCK_DEFS);
        defined = true;
      }
      const theme = Blockly.Theme.defineTheme("fiverax", {
        name: "fiverax",
        base: Blockly.Themes.Classic,
        componentStyles: {
          workspaceBackgroundColour: "#100d09",
          toolboxBackgroundColour: "#17130e",
          toolboxForegroundColour: "#f2ecdf",
          flyoutBackgroundColour: "#1f1a13",
          flyoutForegroundColour: "#f2ecdf",
          flyoutOpacity: 0.97,
          scrollbarColour: "#5b5140",
          scrollbarOpacity: 0.5,
          insertionMarkerColour: "#ffffff",
          insertionMarkerOpacity: 0.3,
          cursorColour: "#d4b06a"
        },
        fontStyle: { family: "inherit", size: 12 }
      });
      const workspace = Blockly.inject(host.current, {
        toolbox: TOOLBOX,
        renderer: "zelos",
        theme,
        trashcan: true,
        sounds: false,
        grid: { spacing: 28, length: 2, colour: "#2a241a", snap: true },
        zoom: { controls: true, wheel: true, startScale: 0.72, maxScale: 1.6, minScale: 0.35, scaleSpeed: 1.15 },
        move: { scrollbars: true, drag: true, wheel: false }
      });
      ws.current = workspace;
      load(Blockly, workspace, valueRef.current);
      workspace.addChangeListener((e) => {
        // Blockly nudges loose blocks just after a load: that is not an edit.
        if (e.isUiEvent || workspace.isDragging() || Date.now() - loadedAt.current < 800) return;
        clearTimeout(timer);
        timer = setTimeout(() => onChangeRef.current(Blockly.serialization.workspaces.save(workspace)), 250);
      });
      observer = new ResizeObserver(() => Blockly.svgResize(workspace));
      observer.observe(host.current);
      setReady(true);
    })();
    return () => {
      disposed = true;
      clearTimeout(timer);
      observer?.disconnect();
      ws.current?.dispose();
      ws.current = null;
    };
  }, []);

  // Replaced from outside: reload.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (lib.current && ws.current) load(lib.current, ws.current, valueRef.current);
  }, [loadKey]);

  function load(Blockly: BlocklyModule, workspace: import("blockly").WorkspaceSvg, data: unknown) {
    Blockly.Events.disable();
    try {
      workspace.clear();
      if (data && typeof data === "object") Blockly.serialization.workspaces.load(data as Record<string, unknown>, workspace);
    } catch {
      toast("Certains blocs n'ont pas pu être chargés.", "error");
    } finally {
      Blockly.Events.enable();
    }
    loadedAt.current = Date.now();
    workspace.scrollCenter();
  }

  const copy = (p: Player) => {
    const text = p.pos.map((v) => v.toFixed(1)).join(", ");
    void navigator.clipboard?.writeText(text).then(() => toast(`Position de ${p.name} copiée : ${text}`, "ok"), () => toast(text, "info"));
  };

  return (
    <div className="bed">
      <div ref={host} className="bed-stage">{!ready && <p className="muted bed-loading">Chargement des blocs…</p>}</div>
      <div className="bed-foot">
        {warnings.length > 0 ? (
          <div className="bed-warn">
            {warnings.map((w) => <span key={w}><AlertTriangle size={13} />{w}</span>)}
          </div>
        ) : (
          <span className="muted">Prends un bloc jaune (« quand… »), puis glisse des actions dedans. Le code Lua est écrit tout seul (onglets client.lua / server.lua).</span>
        )}
        {players.length > 0 && (
          <div className="bed-players">
            <MapPin size={13} /> Positions en jeu (pour les zones et téléportations) :
            {players.slice(0, 8).map((p) => (
              <button key={p.id} type="button" className="perm" onClick={() => copy(p)} title={p.pos.map((v) => v.toFixed(1)).join(", ")}>
                <Copy size={11} /> {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
