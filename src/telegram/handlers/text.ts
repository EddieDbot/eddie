import type { ContextType, BotLike } from "@gramio/contexts";
import { getOrCreateSession } from "../../claude/session.ts";
import { relay } from "../../claude/relay.ts";
import { sendResponse } from "../sender.ts";
import { logger } from "../../utils/logger.ts";
import { storeConversation } from "../../memory/store.ts";
import { memoryEnabled } from "../../memory/client.ts";
import { createJob } from "../../jobs/manager.ts";
import { spawnJob } from "../../jobs/tmux.ts";
import {
  scanInput,
  hasPendingOverride,
  setPendingOverride,
  clearOverride,
  DEFENSE_PREFIX,
} from "../../security/scan.ts";
import { detectAndStore } from "../../memory/intent.ts";
import { config } from "../../config.ts";

type MessageContext = ContextType<BotLike, "message">;

function parseBackgroundTag(
  text: string,
): { jobPrompt: string; userResponse: string } | null {
  const match = /\[BACKGROUND\]([\s\S]+?)\[\/BACKGROUND\]/i.exec(text);
  if (!match) return null;
  const jobPrompt = match[1]!.trim();
  const userResponse = text.replace(match[0], "").trim();
  return { jobPrompt, userResponse };
}

export async function handleText(context: MessageContext): Promise<void> {
  const text = context.text;
  if (!text || text.startsWith("/")) return;

  const chatId = context.chat.id;
  const sessionId = await getOrCreateSession(chatId);

  logger.info("handler:text", { chatId, sessionId, textLen: text.length });

  const { isInReview, advanceReview } =
    await import("../../proactive/weekly-review.ts");
  if (isInReview(chatId)) {
    const bot = (context as unknown as { bot: import("gramio").Bot }).bot;
    await advanceReview(chatId, text, bot);
    return;
  }

  const scan = scanInput(text);
  if (!scan.clean) {
    if (scan.severity === "high") {
      if (!hasPendingOverride(chatId, text)) {
        setPendingOverride(chatId, text);
        logger.warn("handler:text:injection-blocked", {
          chatId,
          label: scan.label,
        });
        await context.send(
          `Warning: Message flagged (${scan.label}). Send again to override.`,
        );
        return;
      }
      clearOverride(chatId);
      logger.info("handler:text:injection-override", {
        chatId,
        label: scan.label,
      });
    }
    if (scan.severity === "medium") {
      logger.info("handler:text:injection-medium", {
        chatId,
        label: scan.label,
      });
    }
  }

  const relayText =
    !scan.clean && scan.severity === "medium" ? DEFENSE_PREFIX + text : text;

  let result;
  try {
    result = await relay(relayText, { sessionId, chatId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("handler:text:relay-error", { chatId, error: message });
    await context.send(`Relay error: ${message}`);
    return;
  }

  if (result.error) {
    await context.send(`Error: ${result.error}`);
    return;
  }

  if (!result.text) {
    await context.send("(Claude returned an empty response)");
    return;
  }

  const bg = parseBackgroundTag(result.text);
  if (bg) {
    try {
      const job = await createJob("claude", bg.jobPrompt);
      await spawnJob(job);
      const ack = bg.userResponse || "On it.";
      await sendResponse(
        context,
        `${ack}\n\n_Job #${job.id} started in background._`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("handler:text:bg-spawn-error", { chatId, error: message });
      await sendResponse(context, result.text);
    }
  } else {
    let response = result.text;
    if (result.toolUses.length > 0) {
      const toolNames = result.toolUses.map((t) => t.name).join(", ");
      response += `\n\n\u{1F527} Used: ${toolNames}`;
    }
    await sendResponse(context, response);
  }

  if (memoryEnabled) {
    Promise.allSettled([
      storeConversation(sessionId, "user", text),
      storeConversation(sessionId, "assistant", result.text),
      ...(config.INTENT_DETECTION_ENABLED ? [detectAndStore(text)] : []),
    ]).catch(() => {});
  }
}
