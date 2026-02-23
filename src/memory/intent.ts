import { config } from "../config.ts";
import { storeFact } from "./store.ts";
import { logger } from "../utils/logger.ts";

type IntentCategory = "fact" | "goal" | "preference" | "task" | "idea" | "none";

type IntentResult = {
  category: IntentCategory;
  content: string;
};

const INTENT_SYSTEM = `You are a memory classifier for an AI assistant. Given a user message, classify it into one category and extract the core content to store.

Categories:
- fact: stating something true about themselves, the world, or their situation
- goal: expressing something they want to achieve or build
- preference: expressing a like/dislike or how they prefer things done
- task: requesting something specific to be done (short-term action)
- idea: brainstorming or speculating about a possibility
- none: questions, greetings, commands, or messages with no storable insight

Respond with ONLY valid JSON: {"category": "...", "content": "..."}
The "content" should be a clean, third-person statement suitable for memory storage.
If category is "none", set content to "".`;

export async function classifyIntent(msg: string): Promise<IntentResult> {
  if (!config.ANTHROPIC_API_KEY) {
    return { category: "none", content: "" };
  }

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
        max_tokens: 128,
        system: INTENT_SYSTEM,
        messages: [{ role: "user", content: msg }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return { category: "none", content: "" };

    const data = (await res.json()) as { content: { type: string; text: string }[] };
    const text = data.content.find((c) => c.type === "text")?.text ?? "";
    const parsed = JSON.parse(text.trim()) as IntentResult;
    return parsed;
  } catch {
    return { category: "none", content: "" };
  }
}

export async function detectAndStore(msg: string): Promise<void> {
  const result = await classifyIntent(msg);
  if (result.category === "none" || !result.content) return;
  await storeFact(result.content, result.category, "intent-detection");
  logger.debug("intent:stored", { category: result.category });
}
