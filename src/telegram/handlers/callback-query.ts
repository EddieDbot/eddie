import type { Bot } from "gramio";
import { getSupabase, memoryEnabled } from "../../memory/client.ts";
import { logger } from "../../utils/logger.ts";
import { config } from "../../config.ts";
import { sendGmail } from "../../comms/google/gmail-send.ts";
import {
  getDraft,
  updateDraft,
  markReplySent,
  markReplySkipped,
} from "../../comms/contra-intake.ts";

export const pendingFeedbackReason = new Map<number, string>();
export const pendingContraEdit = new Map<number, string>(); // userId → threadId

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

  // ── Contra intake ─────────────────────────────────────────────────────────
  bot.callbackQuery(/^contra:/, async (ctx) => {
    const data = ctx.payload.data;
    if (!data) return;

    const [, action, ...rest] = data.split(":");
    const threadId = rest.join(":");
    if (!threadId) return;

    if (action === "approve") {
      const draft = await getDraft(threadId);
      if (!draft) {
        await ctx.answerCallbackQuery({ text: "Draft not found." });
        return;
      }

      const result = await sendGmail(config.EDDIE_OWNER_EMAIL, {
        to: draft.leadEmail,
        subject: `Re: Contra Inquiry`,
        body: draft.responseBody,
        threadId,
      });

      if (result.ok) {
        await markReplySent(threadId);
        await ctx.answerCallbackQuery({ text: "Sent." });
        await bot.api.sendMessage({
          chat_id: config.OWNER_TELEGRAM_ID,
          text: `✅ Reply sent to ${draft.leadEmail}`,
        });
        logger.info("contra-intake:sent", {
          threadId,
          leadEmail: draft.leadEmail,
        });
      } else {
        await ctx.answerCallbackQuery({ text: "Send failed — check logs." });
        logger.error("contra-intake:send-failed", {
          threadId,
          error: result.error,
        });
      }
    } else if (action === "skip") {
      await markReplySkipped(threadId);
      await ctx.answerCallbackQuery({ text: "Skipped." });
      logger.info("contra-intake:skipped", { threadId });
    } else if (action === "edit") {
      const userId = ctx.payload.from.id;
      pendingContraEdit.set(userId, threadId);
      await ctx.answerCallbackQuery({
        text: "Send your revised reply text.",
      });
    }
  });
}
