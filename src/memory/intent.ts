import { runPromptMulti, parseJsonFromLLM } from "../llm/run-prompt-multi.ts";
import { storeFact } from "./store.ts";
import { logger } from "../utils/logger.ts";

type IntentCategory =
  | "fact"
  | "goal"
  | "preference"
  | "task"
  | "idea"
  | "forget"
  | "none";

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
- forget: explicitly asking to remove, delete, or make the assistant forget something
- none: questions, greetings, commands, or messages with no storable insight

Examples of "forget": "forget that I mentioned X", "remove the memory about Y", "don't remember that"

Respond with ONLY valid JSON: {"category": "...", "content": "..."}
The "content" should be a clean, third-person statement suitable for memory storage.
If category is "none", set content to "".`;

export async function classifyIntent(msg: string): Promise<IntentResult> {
  const { text, ok } = await runPromptMulti({
    system: INTENT_SYSTEM,
    prompt: msg,
    maxWaitMs: 10_000,
    source: "intent",
  });
  if (!ok) return { category: "none", content: "" };
  return parseJsonFromLLM<IntentResult>(text, {
    category: "none",
    content: "",
  });
}

export async function detectAndStore(msg: string): Promise<void> {
  const result = await classifyIntent(msg);
  if (result.category === "none" || !result.content) return;
  if (result.category === "forget" && result.content) {
    const { forgetMemory } = await import("./store.ts");
    const result2 = await forgetMemory(result.content);
    logger.debug("intent:forgot", { deleted: result2.deleted });
    return;
  }
  await storeFact(
    result.content,
    result.category as "goal" | "fact" | "preference" | "task" | "idea",
    "intent-detection",
  );
  logger.debug("intent:stored", { category: result.category });
}
