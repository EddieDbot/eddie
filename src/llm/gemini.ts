import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { logUsage } from "../memory/usage.ts";
import { tickTool } from "../memory/tool-ticker.ts";

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message: string };
}

export type CallGeminiOpts = {
  prompt: string;
  system?: string;
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  source?: string;
};

export async function callGemini(opts: CallGeminiOpts): Promise<string> {
  const apiKey = config.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not set");

  const model = opts.model ?? config.GEMINI_EXTRACT_MODEL;
  const maxOutputTokens = opts.maxOutputTokens ?? 8192;
  const temperature = opts.temperature ?? 0.1;
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: { maxOutputTokens, temperature },
  };

  if (opts.system) {
    body.systemInstruction = { parts: [{ text: opts.system }] };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as GeminiResponse;
  if (data.error) throw new Error(`Gemini error: ${data.error.message}`);

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");

  await logUsage({
    model,
    input_tokens: Math.ceil(opts.prompt.length / 4),
    output_tokens: Math.ceil(text.length / 4),
    est_cost_usd: 0,
    source: opts.source ?? "gemini-rest",
  }).catch((e) => logger.warn("gemini:usage-log-error", { error: String(e) }));

  await tickTool({ tool_type: "model", tool_name: "gemini-rest" }).catch((e) =>
    logger.warn("gemini:tick-error", { error: String(e) }),
  );

  return text;
}

export function parseJsonFromGemini<T>(text: string, fallback: T): T {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}
