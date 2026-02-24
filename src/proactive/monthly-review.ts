import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { runPrompt } from "../claude/run-prompt.ts";
import {
  AREAS_DIR,
  STATE_DIR,
  EDDIE_STATE_FILE,
} from "../memory/brain-vault-paths.ts";
import { resolve } from "node:path";
import type { Bot } from "gramio";

const VISION_PATH = resolve(AREAS_DIR, "Master Vision.md");

export function isMonthlyReviewDay(): boolean {
  if (!config.MONTHLY_REVIEW_ENABLED) return false;
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const date = now.getDate();
  return day === 0 && date <= 7;
}

export async function runMonthlyReview(
  bot: Bot,
  chatId: number,
): Promise<void> {
  if (!config.MONTHLY_REVIEW_ENABLED) return;

  let vision = "";
  let state = "";
  try {
    vision = await Bun.file(VISION_PATH).text();
    state = await Bun.file(EDDIE_STATE_FILE).text();
  } catch {}

  const monthLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const { text, ok } = await runPrompt({
    system: `You are EDDIE's monthly review facilitator. Given Nicholas's vision document and current state, generate a structured monthly review that:
1. Scores alignment between current activities and vision (1-10)
2. Identifies the biggest drift areas
3. Recommends 3 course corrections for next month
4. Celebrates wins from this month
5. Sets 1 north-star focus for next month

Be direct, specific, and actionable. Nicholas values bluntness over diplomacy.`,
    prompt: `Vision:\n${vision.slice(0, 1500)}\n\nCurrent state:\n${state.slice(0, 1500)}\n\nMonth: ${monthLabel}`,
    model: "claude-sonnet-4-6",
    maxWaitMs: 60_000,
  });

  if (!ok || !text) return;

  const report = `# Monthly Review — ${monthLabel}\n\n${text}`;

  const reportPath = resolve(
    STATE_DIR,
    `monthly-review-${new Date().toISOString().slice(0, 7)}.md`,
  );
  await Bun.write(reportPath, report);

  await bot.api.sendMessage({ chat_id: chatId, text: report.slice(0, 4000) });
  logger.info("monthly-review:sent");
}
