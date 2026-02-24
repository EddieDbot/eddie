import { searchMemory } from "../memory/search.ts";
import { memoryEnabled } from "../memory/client.ts";
import { getSupabase } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";

export type BrainstormLevel = 1 | 2 | 3 | 4;

const LEVEL_INSTRUCTIONS: Record<BrainstormLevel, string> = {
  1: "Surface-level brainstorm. Generate practical, immediately actionable ideas.",
  2: "Intermediate brainstorm. Mix practical and creative ideas, explore adjacent possibilities.",
  3: "Deep brainstorm. Challenge assumptions, explore contrarian angles, think 2nd and 3rd order effects.",
  4: "Contrarian deep-dive. Actively argue against the obvious, find the non-obvious insights, question the premise itself.",
};

type BrainstormSession = {
  topic: string;
  startedAt: number;
  level: BrainstormLevel;
};

const activeSessions = new Map<number, BrainstormSession>();

export function startBrainstorm(
  chatId: number,
  topic: string,
  level: BrainstormLevel = 2,
): void {
  activeSessions.set(chatId, { topic, startedAt: Date.now(), level });
}

export function endBrainstorm(chatId: number): void {
  activeSessions.delete(chatId);
}

export function isInBrainstorm(chatId: number): boolean {
  return activeSessions.has(chatId);
}

export async function getBrainstormPrompt(
  chatId: number,
): Promise<string | null> {
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
      logger.error("proactive:brainstorm-context", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return [
    `Nicholas is brainstorming about: "${session.topic}"`,
    memoryContext,
    "",
    `Brainstorm depth: Level ${session.level} — ${LEVEL_INSTRUCTIONS[session.level]}`,
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
