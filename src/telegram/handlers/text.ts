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
import { pendingFeedbackReason, pendingContraEdit } from "./callback-query.ts";
import {
  getSupabase,
  memoryEnabled as feedbackMemoryEnabled,
} from "../../memory/client.ts";
import { updateDraft } from "../../comms/contra-intake.ts";

type MessageContext = ContextType<BotLike, "message">;

async function detectAndIngestUrl(
  text: string,
  context: MessageContext,
): Promise<boolean> {
  if (!config.URL_INGESTION_ENABLED) return false;

  const urlMatch = text.match(/^(https?:\/\/\S+)/);
  if (!urlMatch) return false;

  const url = urlMatch[1]!;
  if (text.replace(url, "").trim().length > 100) return false;

  const isYouTube = /youtube\.com|youtu\.be/.test(url);

  if (isYouTube) {
    await context.send(
      `YouTube URL detected. Spawning transcript ingestion...`,
    );
    const job = await createJob(
      "claude",
      `Use the transcript-ingester agent to download and process this YouTube video: ${url}\nSave transcript to Brain Vault inbox.`,
    );
    await spawnJob(job);
    await context.send(`Ingestion job #${job.id} started.`);
  } else {
    await context.send(`URL detected. Saving summary to Brain Vault...`);
    const job = await createJob(
      "claude",
      `Use the WebFetch tool to fetch and summarize this URL: ${url}\nWrite a structured summary to ~/brain-vault/00 - Inbox/ with filename based on the page title.`,
    );
    await spawnJob(job);
    await context.send(
      `Job #${job.id} started. Summary will be saved to Brain Vault inbox.`,
    );
  }

  logger.info("handler:text:url-ingested", { url, isYouTube });
  return true;
}

async function detectMonologue(
  text: string,
  context: MessageContext,
): Promise<boolean> {
  if (!config.MONOLOGUE_BRIEF_ENABLED) return false;
  if (text.length < 300) return false;

  // Heuristic: long message with multiple sentence breaks = brain dump / monologue
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  if (sentences.length < 3) return false;

  // Detect if it's a voice-to-text / brain dump (not a question or command)
  const isQuestion =
    text.trim().endsWith("?") || text.toLowerCase().startsWith("what");
  if (isQuestion) return false;

  await context.send(
    "Sounds like a brain dump. Generating structured brief...",
  );

  const { generateContentBrief } =
    await import("../../proactive/content-brief.ts");
  const brief = await generateContentBrief(text);
  await context.send(brief.slice(0, 4000));
  return true; // handled — don't relay
}

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

  const userId = context.from?.id;
  if (userId && pendingFeedbackReason.has(userId)) {
    const jobId = pendingFeedbackReason.get(userId)!;
    pendingFeedbackReason.delete(userId);
    if (feedbackMemoryEnabled) {
      try {
        await getSupabase()
          .from("job_feedback")
          .update({ reason: text })
          .eq("job_id", jobId)
          .eq("rating", "off")
          .order("created_at", { ascending: false })
          .limit(1);
      } catch {}
    }
    await context.send("Got it, noted.");
    return;
  }

  if (userId && pendingContraEdit.has(userId)) {
    const threadId = pendingContraEdit.get(userId)!;
    pendingContraEdit.delete(userId);
    await updateDraft(threadId, text);
    await context.send(
      "Draft updated. Use the original buttons to approve or skip.",
    );
    return;
  }

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

  if (await detectAndIngestUrl(text, context)) return;
  if (await detectMonologue(text, context)) return;

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

      // Extract human-readable job name from first line of prompt
      const jobName =
        bg.jobPrompt
          .split("\n")[0]!
          .replace(/^#+\s*/, "")
          .trim()
          .slice(0, 80) || "background job";

      await sendResponse(context, `${ack}\n\n_${jobName}_`);
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
