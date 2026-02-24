import type { MessageContext } from "./shared.ts";
import { getSupabase, memoryEnabled } from "../../memory/client.ts";

export async function handleBookmark(context: MessageContext): Promise<void> {
  if (!memoryEnabled) {
    await context.send("Memory not configured.");
    return;
  }
  const text = context.text?.replace(/^\/bookmark\s*/, "").trim() ?? "";
  if (!text) {
    await context.send(
      "Usage: /bookmark <label> | <content>\nExample: /bookmark project-idea | Build an AI tool that...",
    );
    return;
  }

  const pipeIdx = text.indexOf("|");
  let label: string, content: string;
  if (pipeIdx > 0) {
    label = text.slice(0, pipeIdx).trim();
    content = text.slice(pipeIdx + 1).trim();
  } else {
    label = `bookmark-${Date.now()}`;
    content = text;
  }

  const { error } = await getSupabase()
    .from("bookmarks")
    .insert({ chat_id: context.chat.id, label, content });

  if (error) {
    await context.send(`Error: ${error.message}`);
    return;
  }
  await context.send(`Bookmarked: "${label}"`);
}

export async function handleResume(context: MessageContext): Promise<void> {
  if (!memoryEnabled) {
    await context.send("Memory not configured.");
    return;
  }
  const label = context.text?.replace(/^\/resume\s*/, "").trim() ?? "";

  const query = getSupabase()
    .from("bookmarks")
    .select("id, label, content, created_at")
    .eq("chat_id", context.chat.id)
    .order("created_at", { ascending: false });

  if (label) {
    query.ilike("label", `%${label}%`);
  }

  const { data, error } = await query.limit(5);

  if (error) {
    await context.send(`Error: ${error.message}`);
    return;
  }
  if (!data || data.length === 0) {
    await context.send("No bookmarks found.");
    return;
  }

  const lines = data
    .map((b) => `[${b.label}]\n${String(b.content).slice(0, 200)}`)
    .join("\n\n---\n\n");
  await context.send(`Bookmarks:\n\n${lines}`);

  const first = data[0];
  if (first) {
    await getSupabase()
      .from("bookmarks")
      .update({ resumed_at: new Date().toISOString() })
      .eq("id", first.id);
  }
}
