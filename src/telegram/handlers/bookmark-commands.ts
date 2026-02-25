import type { MessageContext } from "./shared.ts";
import { getSupabase, memoryEnabled } from "../../memory/client.ts";
import { runPrompt } from "../../claude/run-prompt.ts";
import { storeFact } from "../../memory/store.ts";
import { INBOX_DIR } from "../../memory/brain-vault-paths.ts";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { logger } from "../../utils/logger.ts";

function isUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.trim().replace(/\s+/g, " ") ?? "Untitled";
}

async function handleUrlBookmark(
  context: MessageContext,
  url: string,
): Promise<void> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const html = await res.text();
    const title = extractTitle(html);

    const { text: summary, ok } = await runPrompt({
      system: "Summarize this web page in exactly 2 sentences.",
      prompt: `Title: ${title}\nURL: ${url}\nContent (first 2000 chars): ${html.replace(/<[^>]+>/g, " ").slice(0, 2000)}`,
      model: "claude-haiku-4-5-20251001",
    });

    const finalSummary = ok && summary ? summary : "Summary unavailable.";
    const slug = slugify(title);
    const bookmarksDir = resolve(INBOX_DIR, "bookmarks");
    await mkdir(bookmarksDir, { recursive: true });
    const filePath = resolve(bookmarksDir, `${slug}.md`);
    const mdContent = `# ${title}\n\n**URL:** ${url}\n\n${finalSummary}\n`;
    await writeFile(filePath, mdContent, "utf-8");

    await storeFact(
      `Bookmark: ${title} — ${url}\n${finalSummary}`,
      "fact",
      "bookmark",
    );

    const { error } = await getSupabase()
      .from("bookmarks")
      .insert({ chat_id: context.chat.id, label: title, content: url });
    if (error)
      logger.warn("bookmark:supabase-insert", { error: error.message });

    await context.send(`📎 Saved: ${title}\n${finalSummary}`);
  } catch (err) {
    logger.error("bookmark:url-error", {
      error: err instanceof Error ? err.message : String(err),
    });
    await context.send(
      `Bookmark fetch failed: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }
}

export async function handleBookmark(context: MessageContext): Promise<void> {
  if (!memoryEnabled) {
    await context.send("Memory not configured.");
    return;
  }
  const text = context.text?.replace(/^\/bookmark\s*/, "").trim() ?? "";
  if (!text) {
    await context.send(
      "Usage: /bookmark <url> or /bookmark <label> | <content>\nExample: /bookmark https://example.com\nExample: /bookmark project-idea | Build an AI tool that...",
    );
    return;
  }

  if (isUrl(text)) {
    await handleUrlBookmark(context, text);
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
