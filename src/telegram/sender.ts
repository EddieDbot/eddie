import { logger } from "../utils/logger.ts";

const TELEGRAM_MSG_LIMIT = 4096;

type Sendable = {
  send: (text: string, params?: Record<string, unknown>) => Promise<unknown>;
};

type DocumentSendable = {
  sendDocument: (params: Record<string, unknown>) => Promise<unknown>;
};

export function splitMessage(text: string, limit = TELEGRAM_MSG_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < limit * 0.3) {
      splitAt = remaining.lastIndexOf(". ", limit);
    }
    if (splitAt < limit * 0.3) {
      splitAt = remaining.lastIndexOf(" ", limit);
    }
    if (splitAt < limit * 0.3) {
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

export async function sendResponse(context: Sendable, text: string): Promise<void> {
  const chunks = splitMessage(text);

  for (const chunk of chunks) {
    try {
      await context.send(chunk, { parse_mode: "Markdown" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isParseError =
        msg.includes("can't parse entities") ||
        msg.includes("Bad Request") ||
        msg.includes("MARKDOWN");

      if (isParseError) {
        logger.warn("sender:markdown-fallback", { chunkLen: chunk.length });
        await context.send(chunk);
      } else {
        logger.error("sender:send-error", { chunkLen: chunk.length, error: msg });
        throw err;
      }
    }
  }
}

export async function sendFile(context: DocumentSendable, buffer: Buffer, filename: string): Promise<void> {
  await context.sendDocument({
    document: { filename, file: buffer },
  });
}

type VoiceSendable = {
  sendVoice: (voice: Blob | string, params?: Record<string, unknown>) => Promise<unknown>;
};

export async function sendVoice(context: VoiceSendable, audioBuffer: Buffer): Promise<void> {
  await context.sendVoice(new Blob([audioBuffer], { type: "audio/ogg" }));
}
