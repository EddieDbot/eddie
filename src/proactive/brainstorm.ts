import { searchMemory } from "../memory/search.ts";
import { memoryEnabled } from "../memory/client.ts";
import { getSupabase } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";

type BrainstormSession = {
  topic: string;
  startedAt: number;
};

const activeSessions = new Map<number, BrainstormSession>();

export function startBrainstorm(chatId: number, topic: string): void {
  activeSessions.set(chatId, { topic, startedAt: Date.now() });
}

export function endBrainstorm(chatId: number): void {
  activeSessions.delete(chatId);
}

export function isInBrainstorm(chatId: number): boolean {
  return activeSessions.has(chatId);
}

export async function getBrainstormPrompt(chatId: number): Promise<string | null> {
  const session = activeSessions.get(chatId);
  if (!session) return null;

  let memoryContext = "";

  if (memoryEnabled) {
    try {
      const [searchResults, goals] = await Promise.all([
        searchMemory(session.topic, 5, 0.6),
        getSupabase()
          .from("facts")
          .select("content")
          .eq("category", "goal")
          .eq("active", true),
      ]);

      if (searchResults.length > 0) {
        const memories = searchResults.map((r) => `- ${r.content}`).join("\n");
        memoryContext += `\nRelevant memories:\n${memories}`;
      }

      if (goals.data && goals.data.length > 0) {
        const goalList = goals.data.map((g) => g.content).join("; ");
        memoryContext += `\nActive goals: ${goalList}`;
      }
    } catch (err) {
      logger.error("proactive:brainstorm-context", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return [
    `Nicholas is brainstorming about: "${session.topic}"`,
    memoryContext,
    "",
    "As a strategic thinking partner, ask probing questions that:",
    "1. Challenge assumptions about this topic",
    "2. Explore angles Nicholas might not have considered",
    "3. Connect this topic to his active goals if relevant",
    "4. Identify potential blockers or risks",
    "5. Suggest concrete next steps",
    "",
    "Ask 2-3 focused questions. Be direct, not generic.",
  ].join("\n");
}
