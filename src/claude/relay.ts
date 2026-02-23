import { config } from "../config.ts";
import { parseStreamJson, type ParsedResponse } from "./parser.ts";
import { logger } from "../utils/logger.ts";
import { forceNewSession } from "./session.ts";
import { resolve } from "node:path";
import { buildMemoryContext } from "../memory/context.ts";
import { getRelayEnv } from "./env.ts";
import { logUsage } from "../memory/usage.ts";

const OPUS_SIGNALS = [
  /\b(architect|refactor|redesign|rewrite|complex|analysis|analyze|compare|tradeoff|trade-off|review|audit|explain why|deep dive|debug|diagnose|investigate|comprehensive|strategy|strategic|full|complete|entire|all of)\b/i,
  /```[\s\S]{200,}/, // code block > 200 chars
  /\n.*\n.*\n.*\n.*\n/, // 5+ lines = structured input
];

const HAIKU_SIGNALS = [
  /^(what|who|when|where|is |are |do |does |did |can |will |how do i |whats |what's )\b/i,
  /^(status|check|list|show|hi|hey|thanks|ok|yes|no|sure|got it|cool|nice|lol)\b/i,
];

export function selectRelayModel(prompt: string): string {
  if (OPUS_SIGNALS.some((r) => r.test(prompt))) return "claude-opus-4-6";
  if (prompt.length < 120 && HAIKU_SIGNALS.some((r) => r.test(prompt)))
    return "claude-haiku-4-5-20251001";
  return "claude-sonnet-4-6";
}

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const m = model.toLowerCase();
  const inputRate = m.includes("opus") ? 15 : m.includes("haiku") ? 0.25 : 3; // per 1M tokens
  const outputRate = m.includes("opus") ? 75 : m.includes("haiku") ? 1.25 : 15;
  return (inputRate * inputTokens + outputRate * outputTokens) / 1_000_000;
}

export type RelayOptions = {
  sessionId?: string;
  chatId?: number;
  timeoutMs?: number;
};

const activeRelays = new Map<string, Promise<ParsedResponse>>();

const PROJECT_ROOT = resolve(import.meta.dir, "../..");

const EDDIE_SYSTEM_PROMPT = [
  "You are EDDIE (Every Day Digital Intelligence Engine), Nicholas's always-on AI assistant.",
  "You have a laid-back, chill California surfer vibe — warm, cool, and approachable, but sharp and direct when it counts.",
  "You run on his homelab server, relaying Telegram messages through Claude Code.",
  "Brain Vault (Obsidian knowledge base) is at ~/brain-vault/ — search it for past decisions and context.",
  "Write learnings to ~/brain-vault/90 - Agent Memory/Learnings/ and state to ~/brain-vault/90 - Agent Memory/State/.",
  "",
  "## Background Jobs",
  "For tasks that require building, coding, multi-step work, file creation, research, or anything beyond a quick answer — wrap a detailed task prompt in [BACKGROUND]...[/BACKGROUND] tags.",
  "Outside the tags, write a casual acknowledgment to Nicholas.",
  "The background job runs as a separate Claude Code session with full agent access and Brain Vault.",
  "Do NOT start executing the task yourself — classify and acknowledge.",
  "",
  "Should be background: building pages, writing multi-file code, automation workflows, deep research, refactoring",
  "Should NOT be background: answering questions, quick lookups, status checks, one-liner snippets",
].join("\n");

type SpawnOptions = {
  sessionId?: string;
  model?: string;
  skipMemory?: boolean;
  maxTurns?: number;
  systemPrompt?: string;
  useSessionId?: boolean;
};

async function spawnClaude(
  prompt: string,
  sessionId: string | undefined,
  timeoutMs: number,
  opts?: Omit<SpawnOptions, "sessionId">,
): Promise<ParsedResponse> {
  const basePrompt = opts?.systemPrompt ?? EDDIE_SYSTEM_PROMPT;
  const systemPrompt = opts?.skipMemory
    ? basePrompt
    : await buildMemoryContext(prompt).then((mem) =>
        mem ? basePrompt + "\n\n" + mem : basePrompt,
      );

  const args = [
    config.CLAUDE_PATH,
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--append-system-prompt",
    systemPrompt,
    "--dangerously-skip-permissions",
  ];

  if (opts?.model) {
    args.push("--model", opts.model);
  }

  if (opts?.maxTurns) {
    args.push("--max-turns", String(opts.maxTurns));
  }

  if (sessionId) {
    args.push(opts?.useSessionId ? "--session-id" : "--resume", sessionId);
  }

  logger.debug("relay:spawn", { args, timeoutMs });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const proc = Bun.spawn(args, {
      cwd: PROJECT_ROOT,
      env: getRelayEnv(),
      stdout: "pipe",
      stderr: "pipe",
      signal: controller.signal,
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      // Claude Code 2.x exits with code 1 and no stderr when --resume fails (session not found)
      const stderrText = stderr.trim();
      const errorMsg =
        exitCode === 1 && !stderrText
          ? "No session found"
          : stderrText || `claude exited with code ${exitCode}`;
      logger.error("relay:exit", { exitCode, stderr: errorMsg });
      return { text: "", toolUses: [], error: errorMsg };
    }

    const parsed = parseStreamJson(stdout);

    // Log usage if tracking data is available
    if (parsed.usage) {
      const model = opts?.model ?? config.RELAY_MODEL;
      logUsage({
        model,
        input_tokens: parsed.usage.inputTokens,
        output_tokens: parsed.usage.outputTokens,
        est_cost_usd:
          parsed.usage.totalCostUsd ??
          estimateCost(
            model,
            parsed.usage.inputTokens,
            parsed.usage.outputTokens,
          ),
        source: "relay",
      }).catch(() => {}); // fire-and-forget
    }

    logger.debug("relay:parsed", {
      textLen: parsed.text.length,
      toolUses: parsed.toolUses.length,
    });
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isAbort = message.includes("abort");
    logger.error("relay:error", { message, isAbort });
    return {
      text: "",
      toolUses: [],
      error: isAbort ? `Timed out after ${timeoutMs}ms` : message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function execRelay(
  prompt: string,
  options: RelayOptions,
): Promise<ParsedResponse> {
  const { sessionId, chatId, timeoutMs = 120_000 } = options;
  const model = selectRelayModel(prompt);
  logger.debug("relay:model-selected", { model, promptLen: prompt.length });

  const result = await spawnClaude(prompt, sessionId, timeoutMs, { model });

  if (result.error && sessionId) {
    const err = result.error;

    // Session doesn't exist yet — create it with --session-id instead of --resume
    if (err.includes("No session found") || err.includes("not found")) {
      logger.info("relay:session-new", { sessionId, chatId });
      return spawnClaude(prompt, sessionId, timeoutMs, {
        model,
        useSessionId: true,
      });
    }

    // Session locked by another process — force new session
    if (err.includes("already in use")) {
      logger.warn("relay:session-locked", { sessionId, chatId });

      if (chatId) {
        const newSessionId = await forceNewSession(chatId);
        logger.info("relay:session-reset", { chatId, newSessionId });
      }

      logger.info("relay:retry-stateless", { chatId });
      return spawnClaude(prompt, undefined, timeoutMs, { model });
    }
  }

  return result;
}

export async function relay(
  prompt: string,
  options: RelayOptions = {},
): Promise<ParsedResponse> {
  const key = options.sessionId ?? "default";

  const execute = () => execRelay(prompt, options);

  const previous =
    activeRelays.get(key) ??
    Promise.resolve(undefined as unknown as ParsedResponse);
  const current = previous.then(execute, execute);
  activeRelays.set(key, current);

  logger.debug("relay:queued", { key, queued: activeRelays.has(key) });

  try {
    return await current;
  } finally {
    if (activeRelays.get(key) === current) {
      activeRelays.delete(key);
    }
  }
}

const HEARTBEAT_SYSTEM_PROMPT = [
  "You are EDDIE's heartbeat engine. You wake up periodically to check on Nicholas.",
  "You will receive a checklist of things to evaluate and context about recent activity.",
  "Based on the checklist and context, decide ONE of:",
  '- Reply with exactly "HEARTBEAT_OK" if nothing needs attention.',
  "- Reply with a short message (1-3 sentences) to send Nicholas via Telegram if something warrants reaching out.",
  '- Reply with "HEARTBEAT_CALL:<reason>" if something is urgent enough to call him.',
  '- Reply with "HEARTBEAT_PERSONAL:<message>" if the situation requires Nicholas\'s own voice — something that would feel wrong coming from EDDIE (personal relationship messages, sensitive decisions, anything where authenticity matters). Sends with a distinct 🧑 marker.',
  "Be judicious. Most ticks should be HEARTBEAT_OK. Only message when there's genuine value.",
  "IMPORTANT: Always include a confidence score in brackets: HEARTBEAT_OK[95], HEARTBEAT_CALL[80]:reason, HEARTBEAT_PERSONAL[90]:message, HEARTBEAT_TASK[65]:{json}",
  "Confidence 0-100: how sure you are this is the right action. Below 60 = uncertain, above 80 = confident.",
].join(" ");

export async function relayHeartbeat(prompt: string): Promise<ParsedResponse> {
  return spawnClaude(prompt, undefined, 90_000, {
    model: config.HEARTBEAT_MODEL,
    skipMemory: false,
    maxTurns: 1,
    systemPrompt: HEARTBEAT_SYSTEM_PROMPT,
  });
}

const VOICE_SYSTEM_PROMPT =
  "You are EDDIE, Nicholas's AI assistant on a live phone call. You have a laid-back, chill California surfer vibe — warm, cool, approachable. Reply in 1-2 short sentences. Keep it conversational and natural — this is spoken aloud, not text.";

export async function relayVoice(prompt: string): Promise<ParsedResponse> {
  return spawnClaude(prompt, undefined, 30_000, {
    model: "claude-haiku-4-5-20251001",
    skipMemory: true,
    maxTurns: 1,
    systemPrompt: VOICE_SYSTEM_PROMPT,
  });
}

export async function relayVoiceDirect(
  prompt: string,
): Promise<ParsedResponse> {
  if (!config.ANTHROPIC_API_KEY) {
    return relayVoice(prompt);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        system: VOICE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      logger.error("relay:voice-direct-error", {
        status: res.status,
        body: errBody,
      });
      return relayVoice(prompt);
    }

    const data = (await res.json()) as {
      content: { type: string; text: string }[];
    };
    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    logger.debug("relay:voice-direct", { textLen: text.length });
    return { text, toolUses: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("relay:voice-direct-fallback", { error: message });
    return relayVoice(prompt);
  } finally {
    clearTimeout(timeout);
  }
}
