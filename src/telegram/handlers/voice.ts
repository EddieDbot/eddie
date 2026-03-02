import type { ContextType, BotLike } from "@gramio/contexts";

type MessageContext = ContextType<BotLike, "message">;

export async function handleVoice(context: MessageContext): Promise<void> {
  await context.send(
    "Voice messages aren't supported in this build. Send text instead.",
  );
}
