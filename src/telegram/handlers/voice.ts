import type { ContextType, BotLike } from "@gramio/contexts";
import { downloadTelegramFile } from "../../utils/files.ts";
import { transcribe } from "../../voice/stt.ts";
import { synthesize } from "../../voice/tts.ts";
import { getOrCreateSession } from "../../claude/session.ts";
import { relay } from "../../claude/relay.ts";
import { sendResponse, sendVoice } from "../sender.ts";
import { isVoiceReplyEnabled } from "./command.ts";
import { logger } from "../../utils/logger.ts";

type MessageContext = ContextType<BotLike, "message">;

export async function handleVoice(context: MessageContext): Promise<void> {
  const voice = context.voice;
  if (!voice) return;

  const chatId = context.chat.id;
  const sessionId = await getOrCreateSession(chatId);

  logger.info("handler:voice", { chatId, duration: voice.duration });

  let text: string;
  try {
    const audioBuffer = await downloadTelegramFile(context.bot as any, voice.fileId);
    text = await transcribe(audioBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("handler:voice:stt-error", { chatId, error: message });
    await context.send(`Voice transcription failed: ${message}`);
    return;
  }

  logger.info("handler:voice:transcribed", { chatId, textLen: text.length });

  let result;
  try {
    result = await relay(`[Voice]: ${text}`, { sessionId, chatId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("handler:voice:relay-error", { chatId, error: message });
    await context.send(`Relay error: ${message}`);
    return;
  }

  if (result.error) {
    await context.send(`Error: ${result.error}`);
    return;
  }

  const response = result.text || "(empty response)";
  await sendResponse(context, response);

  if (isVoiceReplyEnabled(chatId)) {
    try {
      const audio = await synthesize(response);
      await sendVoice(context, audio);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("handler:voice:tts-error", { chatId, error: message });
    }
  }
}
