import type { MessageContext } from "./shared.ts";
import {
  voiceReplyState,
  modeStateMap,
  upsertSetting,
  isVoiceReplyEnabled,
  getChatMode,
} from "./shared.ts";

export async function handleMode(context: MessageContext): Promise<void> {
  const chatId = context.chat.id;
  const current = getChatMode(chatId);
  const next = current === "auto" ? "draft" : "auto";
  modeStateMap.set(chatId, next);
  await upsertSetting(chatId, "mode", next);
  const desc =
    next === "draft"
      ? "Draft mode enabled. External actions will show drafts before executing."
      : "Auto mode enabled. Actions execute directly.";
  await context.send(desc);
}

export async function handleVoiceReply(
  context: MessageContext,
): Promise<void> {
  const chatId = context.chat.id;
  const current = isVoiceReplyEnabled(chatId);
  const next = !current;
  voiceReplyState.set(chatId, next);
  await upsertSetting(chatId, "voiceReply", String(next));
  await context.send(`Voice replies ${next ? "enabled" : "disabled"}.`);
}

export async function handleConsolidate(
  context: MessageContext,
): Promise<void> {
  await context.send("Running consolidation...");
  try {
    const { runConsolidation } = await import("../../proactive/consolidate.ts");
    await runConsolidation();
    await context.send("Done. eddie-current.md updated.");
  } catch (err) {
    await context.send(
      `Consolidation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function handleRestart(context: MessageContext): Promise<void> {
  await context.send("Restarting...");
  const { spawnSync } = await import("bun");
  spawnSync(["systemctl", "--user", "restart", "eddie"]);
}
