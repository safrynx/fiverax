import { AiQuotaError, consumeAi, type AiScope } from "./ai-quota";
import type { Screenshot } from "./security";

/**
 * AI analysis of in-game screenshots: is a cheat menu, an ESP overlay or an aimbot circle on screen?
 * Same OpenAI-compatible API as the weekly review (AI_BASE_URL / AI_API_KEY), with a vision model:
 *   Groq   AI_VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct   (default)
 *   Gemini AI_VISION_MODEL=gemini-2.0-flash
 */

const PROMPT = `Tu es l'anticheat d'un serveur GTA V RP (FiveM). Tu reçois une capture de l'écran d'un joueur.
Cherche des signes de triche visibles :
- menu de cheat (fenêtre/onglets type Eulen, RedEngine, Skript, Lynx… listes "Self / Weapon / Vehicle / Online / Teleport / Spawn", cases à cocher, sliders),
- ESP : boîtes, squelettes, lignes ou noms/distances dessinés sur des joueurs ou des entités,
- cercle de FOV d'aimbot, crosshair ajouté, texte "aimbot", "godmode", "noclip",
- overlays de debug inhabituels.
Les éléments normaux d'un serveur RP NE SONT PAS de la triche : HUD (vie, faim, argent, radar), menus de jobs, inventaire, téléphone, F1/F5, chat, menus admin officiels du serveur, notifications.
Réponds UNIQUEMENT en JSON : {"verdict":"clean|suspicious|cheat","score":0-100,"summary":"..."}
- score = ta confiance qu'il y a de la triche (0 = sûr que non, 100 = certain).
- summary : une phrase en français décrivant ce que tu vois de suspect (ou "Rien de suspect").`;

export function visionConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY);
}

type Verdict = Pick<Screenshot, "verdict" | "score" | "summary">;

/** Pure: read the model's JSON reply (tolerates code fences and stray text). */
export function parseVerdict(text: string): Verdict | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]) as { verdict?: unknown; score?: unknown; summary?: unknown };
    const verdict = typeof data.verdict === "string" ? data.verdict.toLowerCase().trim() : "";
    if (verdict !== "clean" && verdict !== "suspicious" && verdict !== "cheat") return null;
    const score = Math.max(0, Math.min(100, Math.round(Number(data.score) || 0)));
    const summary = typeof data.summary === "string" && data.summary.trim() ? data.summary.trim().slice(0, 400) : null;
    return { verdict, score, summary };
  } catch {
    return null;
  }
}

/** `quota`: the server the screenshot belongs to (and the staff member who asked for the analysis, if any). */
export async function analyzeScreenshot(image: Uint8Array, mime: string, quota: Omit<AiScope, "kind">): Promise<Verdict> {
  if (!visionConfigured()) return { verdict: "skipped", score: null, summary: "IA non configurée (AI_API_KEY)" };
  try {
    await consumeAi({ ...quota, kind: "vision" });
  } catch (error) {
    if (error instanceof AiQuotaError) {
      return { verdict: "skipped", score: null, summary: error.message === "ai_disabled" ? "IA désactivée sur la plateforme" : "Quota IA du jour atteint" };
    }
    throw error;
  }
  const base = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = process.env.AI_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
  const url = `data:${mime};base64,${Buffer.from(image).toString("base64")}`;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 300,
        messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url } }] }]
      }),
      signal: AbortSignal.timeout(40_000)
    });
    if (!res.ok) return { verdict: "error", score: null, summary: `Le service IA a répondu ${res.status}` };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return parseVerdict(data.choices?.[0]?.message?.content ?? "") ?? { verdict: "error", score: null, summary: "Réponse de l'IA illisible" };
  } catch (error) {
    return { verdict: "error", score: null, summary: error instanceof Error ? error.message.slice(0, 200) : "Erreur IA" };
  }
}
