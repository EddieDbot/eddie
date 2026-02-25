import type { ContextType, BotLike } from "@gramio/contexts";
import { getOrCreateSession } from "../../claude/session.ts";
import { relay } from "../../claude/relay.ts";
import { sendResponse } from "../sender.ts";
import { downloadTelegramFile } from "../../utils/files.ts";
import { logger } from "../../utils/logger.ts";
import { storeConversation } from "../../memory/store.ts";
import { memoryEnabled } from "../../memory/client.ts";
import { createJob } from "../../jobs/manager.ts";
import { spawnJob } from "../../jobs/tmux.ts";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  scanInput,
  hasPendingOverride,
  setPendingOverride,
  clearOverride,
  DEFENSE_PREFIX,
} from "../../security/scan.ts";

const ATTACHMENTS_DIR = resolve(import.meta.dir, "../../../data/attachments");

type MessageContext = ContextType<BotLike, "message">;

const TEXT_MIMES = new Set([
  "application/json",
  "application/xml",
  "text/xml",
  "application/javascript",
  "text/javascript",
]);

function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || TEXT_MIMES.has(mime);
}

export async function handlePhoto(context: MessageContext): Promise<void> {
  const photos = context.photo;
  if (!photos || photos.length === 0) return;

  const chatId = context.chat.id;
  const sessionId = await getOrCreateSession(chatId);
  const largest = photos[photos.length - 1]!;
  const caption = context.caption ?? "";

  logger.info("handler:photo", { chatId, sessionId, fileId: largest.fileId });

  const scan = caption ? scanInput(caption) : ({ clean: true } as const);
  if (!scan.clean) {
    if (scan.severity === "high") {
      if (!hasPendingOverride(chatId, caption)) {
        setPendingOverride(chatId, caption);
        logger.warn("handler:photo:injection-blocked", {
          chatId,
          label: scan.label,
        });
        await context.send(
          `Warning: Caption flagged (${scan.label}). Send again to override.`,
        );
        return;
      }
      clearOverride(chatId);
      logger.info("handler:photo:injection-override", {
        chatId,
        label: scan.label,
      });
    }
    if (scan.severity === "medium") {
      logger.info("handler:photo:injection-medium", {
        chatId,
        label: scan.label,
      });
    }
  }

  const effectiveCaption =
    !scan.clean && scan.severity === "medium"
      ? DEFENSE_PREFIX + caption
      : caption;

  let buffer: Buffer;
  try {
    buffer = await downloadTelegramFile(context.bot as any, largest.fileId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("handler:photo:download-error", { chatId, error: message });
    await context.send(`Failed to download photo: ${message}`);
    return;
  }

  // Background job detection: /run or [BACKGROUND] in caption → spawn job with attachment
  const isBackgroundJob =
    /^\/run\b/i.test(effectiveCaption) ||
    effectiveCaption.includes("[BACKGROUND]");
  if (isBackgroundJob) {
    try {
      await mkdir(ATTACHMENTS_DIR, { recursive: true });
      const filename = `${Date.now()}.jpg`;
      const attachmentPath = resolve(ATTACHMENTS_DIR, filename);
      await Bun.write(attachmentPath, buffer);

      const jobPrompt =
        effectiveCaption
          .replace(/^\/run\s*/i, "")
          .replace(/\[BACKGROUND\][\s\S]*?\[\/BACKGROUND\]/g, (m) =>
            m.replace("[BACKGROUND]", "").replace("[/BACKGROUND]", "").trim(),
          )
          .trim() || "Analyze this image";

      const job = await createJob("claude", jobPrompt, {
        attachments: [attachmentPath],
      });
      await spawnJob(job);
      logger.info("handler:photo:background-job", {
        chatId,
        jobId: job.id,
        attachment: attachmentPath,
      });
      await context.send(
        `Background job #${job.id} started with image attachment.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("handler:photo:background-job-error", {
        chatId,
        error: message,
      });
      await context.send(`Failed to create background job: ${message}`);
    }
    return;
  }

  const base64 = buffer.toString("base64");
  const prompt = [
    "[Photo received, base64 encoded below]",
    effectiveCaption && `Caption: ${effectiveCaption}`,
    base64,
  ]
    .filter(Boolean)
    .join("\n");

  let result;
  try {
    result = await relay(prompt, { sessionId, chatId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("handler:photo:relay-error", { chatId, error: message });
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

  let response = result.text;
  if (result.toolUses.length > 0) {
    const toolNames = result.toolUses.map((t) => t.name).join(", ");
    response += `\n\n\u{1F527} Used: ${toolNames}`;
  }

  await sendResponse(context, response);

  if (memoryEnabled) {
    const userMsg = caption ? `[Photo] ${caption}` : "[Photo]";
    Promise.allSettled([
      storeConversation(sessionId, "user", userMsg),
      storeConversation(sessionId, "assistant", result.text),
    ]).catch(() => {});
  }
}

export async function handleDocument(context: MessageContext): Promise<void> {
  const doc = context.document;
  if (!doc) return;

  const chatId = context.chat.id;
  const sessionId = await getOrCreateSession(chatId);
  const filename = doc.fileName ?? "unknown";
  const mime = doc.mimeType ?? "application/octet-stream";
  const caption = context.caption ?? "";

  logger.info("handler:document", { chatId, sessionId, filename, mime });

  const scan = caption ? scanInput(caption) : ({ clean: true } as const);
  if (!scan.clean) {
    if (scan.severity === "high") {
      if (!hasPendingOverride(chatId, caption)) {
        setPendingOverride(chatId, caption);
        logger.warn("handler:document:injection-blocked", {
          chatId,
          label: scan.label,
        });
        await context.send(
          `Warning: Caption flagged (${scan.label}). Send again to override.`,
        );
        return;
      }
      clearOverride(chatId);
      logger.info("handler:document:injection-override", {
        chatId,
        label: scan.label,
      });
    }
    if (scan.severity === "medium") {
      logger.info("handler:document:injection-medium", {
        chatId,
        label: scan.label,
      });
    }
  }

  const effectiveCaption =
    !scan.clean && scan.severity === "medium"
      ? DEFENSE_PREFIX + caption
      : caption;

  let buffer: Buffer;
  try {
    buffer = await downloadTelegramFile(context.bot as any, doc.fileId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("handler:document:download-error", { chatId, error: message });
    await context.send(`Failed to download document: ${message}`);
    return;
  }

  let contentSection: string;
  if (isTextMime(mime)) {
    const text = buffer.toString("utf-8").slice(0, 4000);
    contentSection = `Content (first 4000 chars):\n${text}`;
  } else {
    contentSection = `Size: ${buffer.length} bytes`;
  }

  const prompt = [
    `[Document: ${filename} (${mime})]`,
    effectiveCaption && `Caption: ${effectiveCaption}`,
    contentSection,
  ]
    .filter(Boolean)
    .join("\n");

  let result;
  try {
    result = await relay(prompt, { sessionId, chatId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("handler:document:relay-error", { chatId, error: message });
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

  let response = result.text;
  if (result.toolUses.length > 0) {
    const toolNames = result.toolUses.map((t) => t.name).join(", ");
    response += `\n\n\u{1F527} Used: ${toolNames}`;
  }

  await sendResponse(context, response);

  if (memoryEnabled) {
    const userMsg = caption
      ? `[Document: ${filename}] ${caption}`
      : `[Document: ${filename}]`;
    Promise.allSettled([
      storeConversation(sessionId, "user", userMsg),
      storeConversation(sessionId, "assistant", result.text),
    ]).catch(() => {});
  }
}
