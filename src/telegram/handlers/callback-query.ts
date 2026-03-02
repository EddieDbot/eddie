import type { Bot } from "gramio";
import { getSupabase, memoryEnabled } from "../../memory/client.ts";
import { logger } from "../../utils/logger.ts";

export const pendingFeedbackReason = new Map<number, string>();

export function registerCallbackQueryHandlers(bot: Bot): void {
  // ── Job feedback ──────────────────────────────────────────────────────────
  bot.callbackQuery(/^jf:/, async (ctx) => {
    const data = ctx.payload.data;
    if (!data) return;

    const parts = data.split(":");
    if (parts.length < 3) return;

    const rating = parts[1]!;
    const jobId = parts.slice(2).join(":");

    if (rating !== "good" && rating !== "off") return;

    if (memoryEnabled) {
      try {
        await getSupabase().from("job_feedback").insert({
          job_id: jobId,
          rating,
        });
      } catch (err) {
        logger.warn("feedback:insert-failed", {
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (rating === "off") {
      const userId = ctx.payload.from.id;
      pendingFeedbackReason.set(userId, jobId);
      await ctx.answerCallbackQuery({
        text: "What was off? Send a message with details.",
      });
    } else {
      await ctx.answerCallbackQuery({ text: "Noted, thanks!" });
    }

    logger.info("feedback:received", { jobId, rating });
  });
}
