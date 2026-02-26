/**
 * Claude Executor — abstraction layer for Claude invocation.
 *
 * Isolates the Claude Code CLI dependency so it can be swapped without
 * touching call sites. Currently one live implementation (CLI subprocess).
 * SDK path is a stub — implement when/if CLI dependency becomes a problem.
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

export interface ClaudeExecutor {
  run(opts: RunPromptOptions): Promise<RunPromptResult>;
}

function safeEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env as Record<string, string>).filter(
      ([k]) => k !== "CLAUDECODE",
    ),
  );
  if (config.EDDIE_CLAUDE_HOME) env.HOME = config.EDDIE_CLAUDE_HOME;
  return env;
}

/**
 * Primary executor — Claude Code CLI as subprocess.
 * Uses stored subscription credentials in ~/.claude/. No API key required.
 */
export class ClaudeCliExecutor implements ClaudeExecutor {
  async run({
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
}

/**
 * SDK executor — Anthropic API directly, no CLI dependency.
 * Requires ANTHROPIC_API_KEY. Falls back to CLI until implemented.
 *
 * Implement this when: (a) CLI breaks or subscription changes, and
 * (b) ANTHROPIC_API_KEY is available and the API cost is acceptable.
 */
export class AnthropicSdkExecutor implements ClaudeExecutor {
  async run(opts: RunPromptOptions): Promise<RunPromptResult> {
    // TODO: implement via @anthropic-ai/sdk when needed
    return new ClaudeCliExecutor().run(opts);
  }
}

/** Returns the active executor. Swap here when ready to migrate. */
export function getExecutor(): ClaudeExecutor {
  // Future: if (config.CLAUDE_EXECUTOR === "sdk" && config.ANTHROPIC_API_KEY)
  //           return new AnthropicSdkExecutor();
  return new ClaudeCliExecutor();
}
