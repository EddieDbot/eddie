// weekly-content.ts — Sunday evening content batch: process unread bookmarks + brainstorm files
import type { Bot } from "gramio";
import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { generateContentBrief } from "./content-brief.ts";
import { BRAIN_VAULT_ROOT } from "../memory/brain-vault-paths.ts";

const BOOKMARKS_DIR = resolve(BRAIN_VAULT_ROOT, "00 - Inbox/bookmarks");
const INBOX_DIR = resolve(BRAIN_VAULT_ROOT, "00 - Inbox");

function msUntilSunday7pmCST(): number {
  const now = new Date();
  const nowLocal = new Date(
    now.toLocaleString("en-US", { timeZone: config.TIMEZONE }),
  );
  const target = new Date(nowLocal);
  // Sunday = 0
  const daysUntilSunday = (7 - nowLocal.getDay()) % 7;
  target.setDate(nowLocal.getDate() + (daysUntilSunday === 0 ? 0 : daysUntilSunday));
  target.setHours(19, 0, 0, 0);
  // If it's already past Sunday 7pm, schedule for next Sunday
  if (target <= nowLocal) target.setDate(target.getDate() + 7);
  return target.getTime() - nowLocal.getTime();
}

async function getRecentMdFiles(dir: string, days = 7): Promise<string[]> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  try {
    const entries = await readdir(dir);
    const mdFiles = entries.filter((f) => f.endsWith(".md"));
    const results: string[] = [];
    for (const f of mdFiles) {
      const fullPath = resolve(dir, f);
      try {
        const s = await stat(fullPath);
        if (s.birthtimeMs >= cutoff || s.mtimeMs >= cutoff) {
          results.push(fullPath);
        }
      } catch {
        // skip inaccessible files
      }
    }
    return results;
  } catch {
    return [];
  }
}

function hasContentBriefTag(content: string): boolean {
  return /content_brief:\s*true/i.test(content);
}

async function markAsProcessed(filePath: string): Promise<void> {
  const content = await readFile(filePath, "utf-8");
  if (content.startsWith("---")) {
    // Has frontmatter — insert before closing ---
    const endIdx = content.indexOf("---", 3);
    if (endIdx > 0) {
      const updated =
        content.slice(0, endIdx) + "content_brief: true\n" + content.slice(endIdx);
      await writeFile(filePath, updated);
      return;
    }
  }
  // No frontmatter — prepend one
  await writeFile(filePath, `---\ncontent_brief: true\n---\n${content}`);
}

export async function runWeeklyContent(bot: Bot): Promise<void> {
  logger.info("weekly-content:start");

  const [bookmarkFiles, inboxFiles] = await Promise.all([
    getRecentMdFiles(BOOKMARKS_DIR),
    getRecentMdFiles(INBOX_DIR).then((files) =>
      files.filter((f) => f.includes("brainstorm-")),
    ),
  ]);

  const allFiles = [...bookmarkFiles, ...inboxFiles];
  const processed: string[] = [];

  for (const filePath of allFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      if (hasContentBriefTag(content)) continue;

      const title = filePath.split("/").pop()?.replace(/\.md$/, "") ?? "Untitled";
      const summary = content.slice(0, 500);
      await generateContentBrief(title, summary);
      await markAsProcessed(filePath);
      processed.push(title);
    } catch (err) {
      logger.warn("weekly-content:file-error", {
        file: filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const msg = processed.length > 0
    ? `Weekly Content Batch\n${processed.length} items processed\n\n${processed.map((t) => `- ${t}`).join("\n")}`
    : "Weekly Content Batch\nNo new items to process this week.";

  await bot.api
    .sendMessage({ chat_id: config.OWNER_TELEGRAM_ID, text: msg })
    .catch(() => {});

  logger.info("weekly-content:done", { count: processed.length });
}

export function startWeeklyContent(bot: Bot): void {
  const delay = msUntilSunday7pmCST();
  logger.info("weekly-content:scheduled", { delayMs: delay });

  setTimeout(() => {
    runWeeklyContent(bot).catch((err) =>
      logger.error("weekly-content:error", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    // Re-schedule weekly
    setInterval(
      () => {
        runWeeklyContent(bot).catch((err) =>
          logger.error("weekly-content:error", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      },
      7 * 24 * 60 * 60 * 1000,
    );
  }, delay);
}
