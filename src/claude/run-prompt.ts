/**
 * runPrompt — inline LLM calls via claude CLI subprocess.
 *
 * RULE: Never call api.anthropic.com directly. Nicholas has subscriptions.
 * Always go through the claude binary using stored credentials.
 */
import { config } from "../config.ts";

export type RunPromptOptions = {
  prompt: string;
  system?: string;
  model?: string;
  maxWaitMs?: number;
};

export type RunPromptResult = {
  text: string;
  ok: boolean;
};

// Env without CLAUDECODE so subprocess isn't blocked by nested-session guard
function safeEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env as Record<string, string>).filter(
      ([k]) => k !== "CLAUDECODE",
    ),
  );
}

export async function runPrompt({
  prompt,
  system,
  model = "claude-haiku-4-5-20251001",
  maxWaitMs = 20_000,
}: RunPromptOptions): Promise<RunPromptResult> {
  const fullPrompt = system ? `${system}\n\n${prompt}` : prompt;
  try {
    const proc = Bun.spawn(
      [
        config.CLAUDE_PATH,
        "--model",
        model,
        "--print",
        "--output-format",
        "text",
        fullPrompt,
      ],
      { stdout: "pipe", stderr: "pipe", env: safeEnv() },
    );

    const text = await Promise.race([
      new Response(proc.stdout).text(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), maxWaitMs),
      ),
    ]);

    return { text: text.trim(), ok: true };
  } catch {
    return { text: "", ok: false };
  }
}

/** Convenience: parse JSON from LLM output, with a regex fallback for fenced blocks */
export function parseJsonFromOutput<T>(text: string, fallback: T): T {
  try {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ??
      text.match(/(\{[\s\S]*\})/);
    return JSON.parse(match?.[1] ?? text) as T;
  } catch {
    return fallback;
  }
}
