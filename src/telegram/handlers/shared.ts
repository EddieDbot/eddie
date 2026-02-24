import type { ContextType, BotLike } from "@gramio/contexts";
import { getSupabase, memoryEnabled } from "../../memory/client.ts";

export type MessageContext = ContextType<BotLike, "message">;

export const voiceReplyState = new Map<number, boolean>();
export const modeStateMap = new Map<number, "auto" | "draft">();

export async function upsertSetting(
  chatId: number,
  key: string,
  value: string,
): Promise<void> {
  if (!memoryEnabled) return;
  const { error } = await getSupabase()
    .from("user_settings")
    .upsert(
      { chat_id: chatId, key, value, updated_at: new Date().toISOString() },
      { onConflict: "chat_id,key" },
    );
  if (
    error &&
    !error.message.includes("schema cache") &&
    !error.message.includes("does not exist")
  ) {
    console.warn("user_settings:upsert-error", error.message);
  }
}

export async function loadUserSettings(): Promise<void> {
  if (!memoryEnabled) return;
  const { data } = await getSupabase()
    .from("user_settings")
    .select("chat_id, key, value");
  if (!data) return;
  for (const row of data) {
    const chatId = row.chat_id as number;
    if (row.key === "voiceReply")
      voiceReplyState.set(chatId, row.value === "true");
    if (row.key === "mode")
      modeStateMap.set(chatId, row.value as "auto" | "draft");
  }
}

export function isVoiceReplyEnabled(chatId: number): boolean {
  return voiceReplyState.get(chatId) ?? false;
}

export function getChatMode(chatId: number): "auto" | "draft" {
  return modeStateMap.get(chatId) ?? "auto";
}

export const CHANNEL_LABELS: Record<string, string> = {
  gmail: "📧 Gmail",
  "gmail-eddie": "📧 EDDIE Mail",
  "google-calendar": "📅 Google Calendar",
  "icloud-calendar": "📅 iCloud Calendar",
  imessage: "💬 iMessage",
  slack: "💬 Slack",
  whatsapp: "💬 WhatsApp",
};
