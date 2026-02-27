import { callGemini, parseJsonFromGemini } from "./gemini.ts";
import { runPrompt } from "../claude/run-prompt.ts";
import { logger } from "../utils/logger.ts";

export type RunPromptMultiOpts = {
  prompt: string;
  system?: string;
  provider?: "gemini" | "claude" | "auto";
  model?: string;
  maxWaitMs?: number;
  fallbackOnError?: boolean;
  source?: string;
};

export type RunPromptMultiResult = {
  text: string;
  ok: boolean;
  provider: string;
};

export async function runPromptMulti(opts: RunPromptMultiOpts): Promise<RunPromptMultiResult> {
  const provider = opts.provider === "claude" ? "claude" : "gemini";
  const fallback = opts.fallbackOnError !== false;

  if (provider === "gemini") {
    try {
      const text = await callGemini({ prompt: opts.prompt, system: opts.system, source: opts.source });
      return { text, ok: true, provider: "gemini" };
    } catch (err) {
      if (fallback) {
        logger.warn("gemini:fallback-to-claude", { error: err instanceof Error ? err.message : String(err) });
        const result = await runPrompt({ prompt: opts.prompt, system: opts.system, model: opts.model ?? "claude-haiku-4-5-20251001", maxWaitMs: opts.maxWaitMs ?? 20_000 });
        return { ...result, provider: "claude-fallback" };
      }
      return { text: "", ok: false, provider: "gemini" };
    }
  }

  const result = await runPrompt({ prompt: opts.prompt, system: opts.system, model: opts.model ?? "claude-haiku-4-5-20251001", maxWaitMs: opts.maxWaitMs ?? 20_000 });
  return { ...result, provider: "claude" };
}

export { parseJsonFromGemini as parseJsonFromLLM };
