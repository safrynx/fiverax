"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, RefreshCw, Send } from "lucide-react";
import type { UITest } from "@/lib/studio-shared";

/**
 * Live preview of a NUI page, as FiveM shows it: 1920x1080 scaled down, transparent over a game-like background.
 * The page runs in a sandboxed iframe (scripts, no access to the panel). A shim stands in for the game:
 * GetParentResourceName(), and fetch("https://<resource>/<callback>") is answered here and listed (NUI callbacks).
 * The test messages are sent like SendNUIMessage does (a "message" event with the data).
 */

const BACKGROUNDS = {
  day: { label: "Ville (jour)", css: "linear-gradient(180deg, #8fb8de 0%, #c9d9e6 45%, #6b7a86 46%, #4b5560 70%, #2f353b 100%)" },
  night: { label: "Nuit", css: "radial-gradient(1200px 500px at 70% 30%, rgba(255,170,90,0.25), transparent 60%), linear-gradient(180deg, #0b1020 0%, #1a2035 50%, #20242c 51%, #121418 100%)" },
  check: { label: "Damier", css: "repeating-conic-gradient(#2a2a2a 0% 25%, #3a3a3a 0% 50%) 50% / 40px 40px" }
} as const;

function shim(resource: string): string {
  return `<script>(function(){
  var RES = ${JSON.stringify(resource)};
  window.GetParentResourceName = function(){ return RES; };
  window.invokeNative = function(){};
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function(input, init){
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var m = /^https?:\\/\\/([^\\/.]+)\\/(.*)$/.exec(url);
    if (m) {
      var body = init && init.body;
      try { body = JSON.parse(body); } catch (e) {}
      parent.postMessage({ __fiverax: 'nui', resource: m[1], name: m[2], body: body === undefined ? null : body }, '*');
      return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch ? realFetch(input, init) : Promise.reject(new Error('fetch'));
  };
  window.addEventListener('error', function(e){ parent.postMessage({ __fiverax: 'error', message: String(e.message || e) + (e.lineno ? ' (ligne ' + e.lineno + ')' : '') }, '*'); });
})();</script>`;
}

/** The page with the shim first, so it exists before the page's own scripts run. */
export function previewDocument(html: string, resource: string): string {
  const s = shim(resource);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${s}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${s}</head>`);
  return s + html;
}

type Log = { at: string; kind: "nui" | "error" | "sent"; text: string };

/** `onLoadSend`: messages sent (silently) each time the page loads, e.g. to keep a menu open while it is being built. */
export default function UIPreview({ html, resource, tests, onLoadSend }: { html: string | null; resource: string; tests: UITest[]; onLoadSend?: unknown[] }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [bg, setBg] = useState<keyof typeof BACKGROUNDS>("night");
  const [nonce, setNonce] = useState(0);
  const [custom, setCustom] = useState('{ "action": "open" }');
  const [logs, setLogs] = useState<Log[]>([]);
  const doc = useMemo(() => (html ? previewDocument(html, resource) : null), [html, resource]);

  const log = (kind: Log["kind"], text: string) =>
    setLogs((l) => [{ at: new Date().toLocaleTimeString("fr-FR"), kind, text }, ...l].slice(0, 60));

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / 1920);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { __fiverax?: string; name?: string; body?: unknown; message?: string };
      if (d?.__fiverax === "nui") log("nui", `${d.name} ${JSON.stringify(d.body)}`);
      else if (d?.__fiverax === "error") log("error", String(d.message));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function send(data: unknown) {
    frame.current?.contentWindow?.postMessage(data, "*");
    log("sent", JSON.stringify(data));
  }

  function sendCustom() {
    try {
      send(JSON.parse(custom));
    } catch {
      log("error", "Message de test : JSON invalide");
    }
  }

  return (
    <div className="uip">
      <div className="uip-bar">
        <div className="pill-tabs">
          {(Object.keys(BACKGROUNDS) as (keyof typeof BACKGROUNDS)[]).map((k) => (
            <a key={k} href="#" data-on={bg === k} onClick={(e) => { e.preventDefault(); setBg(k); }}>{BACKGROUNDS[k].label}</a>
          ))}
        </div>
        <button type="button" className="btn sm" onClick={() => { setNonce((n) => n + 1); setLogs([]); }}><RefreshCw size={13} />Recharger la page</button>
      </div>

      <div ref={stage} className="uip-stage" style={{ background: BACKGROUNDS[bg].css, height: 1080 * scale }}>
        {doc ? (
          <iframe
            key={nonce}
            ref={frame}
            title="Aperçu NUI"
            sandbox="allow-scripts"
            srcDoc={doc}
            onLoad={() => onLoadSend?.forEach((m) => frame.current?.contentWindow?.postMessage(m, "*"))}
            style={{ width: 1920, height: 1080, transform: `scale(${scale})`, colorScheme: "normal" }}
          />
        ) : (
          <div className="screen-wait">Pas encore de html/index.html : décris l&apos;interface à l&apos;IA.</div>
        )}
      </div>

      <div className="uip-tests">
        <div className="uip-col">
          <small className="eyebrow">Messages du jeu (SendNUIMessage)</small>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {tests.map((t, i) => (
              <button key={i} type="button" className="btn sm" disabled={!doc} onClick={() => send(t.data)} title={JSON.stringify(t.data)}><Play size={12} />{t.label}</button>
            ))}
            {tests.length === 0 && <span className="muted" style={{ fontSize: 12 }}>L&apos;IA en propose à chaque génération.</span>}
          </div>
          <form style={{ display: "flex", gap: 6 }} onSubmit={(e) => { e.preventDefault(); sendCustom(); }}>
            <input className="field mono" value={custom} onChange={(e) => setCustom(e.target.value)} spellCheck={false} />
            <button className="btn sm" disabled={!doc}><Send size={12} />Envoyer</button>
          </form>
        </div>
        <div className="uip-col">
          <small className="eyebrow">Journal (callbacks NUI, erreurs)</small>
          <div className="uip-log">
            {logs.length === 0 && <span className="muted">Les appels de la page vers le jeu (fetch https://{resource}/…) et les erreurs JS s&apos;affichent ici.</span>}
            {logs.map((l, i) => (
              <div key={i} data-kind={l.kind}><time>{l.at}</time> {l.kind === "sent" ? "→ " : l.kind === "nui" ? "← " : "⚠ "}{l.text}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
