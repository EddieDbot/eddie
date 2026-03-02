import { getSupabase } from "./client.ts";
import { embed } from "./embed.ts";
import { logger } from "../utils/logger.ts";
import { searchMemory } from "./search.ts";

export async function storeConversation(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const embedding = await embed(content);
  const { error } = await getSupabase().from("conversations").insert({
    session_id: sessionId,
    role,
    content,
    embedding,
  });
  if (error)
    logger.error("memory:store-conversation", { error: error.message });
}

export async function storeFact(
  content: string,
  category: "goal" | "fact" | "preference" | "learning" | "task" | "idea",
  source?: string,
): Promise<void> {
  const embedding = await embed(content);
  const { error } = await getSupabase()
    .from("facts")
    .insert({
      content,
      category,
      embedding,
      ...(source && { source }),
    });
  if (error) logger.error("memory:store-fact", { error: error.message });
}

export async function logCommunication(
  channel:
    | "telegram"
    | "voice"
    | "proactive"
    | "gmail"
    | "gmail-eddie"
    | "google-calendar"
    | "icloud-calendar"
    | "imessage"
    | "slack"
    | "whatsapp",
  direction: "inbound" | "outbound",
  summary: string,
): Promise<void> {
  const embedding = await embed(summary);
  const { error } = await getSupabase().from("communication_log").insert({
    channel,
    direction,
    summary,
    embedding,
  });
  if (error) logger.error("memory:log-communication", { error: error.message });
}

export async function forgetMemory(
  query: string,
): Promise<{ deleted: number; matched: string[] }> {
  const matches = await searchMemory(query, 3, 0.75);
  if (matches.length === 0) return { deleted: 0, matched: [] };

  const top = matches[0]!;
  const { error } = await getSupabase().from("facts").delete().eq("id", top.id);

  if (error) {
    logger.error("memory:forget", { error: error.message });
    return { deleted: 0, matched: matches.map((m) => m.content) };
  }

  return { deleted: 1, matched: [top.content] };
}
