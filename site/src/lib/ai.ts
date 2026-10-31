/**
 * Chat call to the OpenAI-compatible API of the site (AI_BASE_URL / AI_API_KEY) asking for a JSON answer.
 * Errors are codes the panel translates: ai_http_<status>, ai_truncated, ai_rate_limited.
 */

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function chatJson(
  system: string,
  user: string,
  opts: { model?: string; maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<string> {
  const base = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = opts.model || process.env.AI_MODEL || "llama-3.3-70b-versatile";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 2000,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }]
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 110_000)
    });
    if (res.status === 429 && attempt === 0) {
      await sleep(8000);
      continue;
    }
    if (!res.ok) throw new Error(`ai_http_${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "length") throw new Error("ai_truncated");
    return choice?.message?.content ?? "";
  }
  throw new Error("ai_rate_limited");
}
