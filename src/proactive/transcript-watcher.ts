import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { Bot } from "gramio";
import { config } from "../config.ts";
import { createJob } from "../jobs/manager.ts";
import { spawnJob } from "../jobs/tmux.ts";
import { logger } from "../utils/logger.ts";

const INBOX_DIR = resolve(homedir(), "brain-vault/00 - Inbox");
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const processedFiles = new Set<string>();

function isTranscriptFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".vtt") ||
    lower.endsWith(".srt") ||
    (lower.includes("transcript") && lower.endsWith(".txt"))
  );
}

async function scanInbox(bot: Bot): Promise<void> {
  try {
    const entries = await readdir(INBOX_DIR);
    for (const entry of entries) {
      if (processedFiles.has(entry)) continue;
      if (!isTranscriptFile(entry)) continue;

      processedFiles.add(entry);
      const filePath = resolve(INBOX_DIR, entry);
      logger.info("transcript-watcher:found", { file: entry });

      try {
        await bot.api.sendMessage({
          chat_id: config.OWNER_TELEGRAM_ID,
          text: `📝 Processing transcript: ${entry}`,
        });

        const job = await createJob("claude", [
          `# Extract Action Items from Transcript`,
          ``,
          `Read the transcript file at: ${filePath}`,
          ``,
          `Extract:`,
          `1. Key action items and next steps`,
          `2. Important decisions made`,
          `3. Notable insights or quotes`,
          ``,
          `Write a summary to ~/brain-vault/00 - Inbox/${entry.replace(/\.[^.]+$/, "")}-summary.md`,
        ].join("\n"));
        await spawnJob(job);
        logger.info("transcript-watcher:job-spawned", { file: entry, jobId: job.id });
      } catch (err) {
        logger.warn("transcript-watcher:spawn-failed", {
          file: entry,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.warn("transcript-watcher:scan-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startTranscriptWatcher(bot: Bot): void {
  logger.info("transcript-watcher:start", { intervalMs: POLL_INTERVAL_MS });
  scanInbox(bot).catch(() => {});
  setInterval(() => scanInbox(bot).catch(() => {}), POLL_INTERVAL_MS);
}
