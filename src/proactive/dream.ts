import { config } from "../config.ts";
import { runPromptMulti, parseJsonFromLLM } from "../llm/run-prompt-multi.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { storeFact } from "../memory/store.ts";
import { searchMemory } from "../memory/search.ts";
import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";
import { readdir, stat, rename, mkdir } from "node:fs/promises";
import { homedir } from "node:os";

const BRAIN_VAULT = resolve(homedir(), "brain-vault");

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hour: h ?? 2, minute: m ?? 0 };
}

function msUntilTime(hour: number, minute: number, timezone: string): number {
  const now = new Date();
  const nowLocal = new Date(
    now.toLocaleString("en-US", { timeZone: timezone }),
  );
  const target = new Date(nowLocal);
  target.setHours(hour, minute, 0, 0);
  if (target <= nowLocal) target.setDate(target.getDate() + 1);
  return target.getTime() - nowLocal.getTime();
}

async function getYesterdayConversations(limit = 200): Promise<string> {
  if (!memoryEnabled) return "No conversations available.";
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await getSupabase()
      .from("conversations")
      .select("role, content, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (!data || data.length === 0)
      return "No conversations in the past 24 hours.";
    return data
      .map((c) => `[${c.role}]: ${c.content.slice(0, 300)}`)
      .join("\n");
  } catch {
    return "Could not fetch conversations.";
  }
}

async function extractLearnings(conversations: string): Promise<string[]> {
  const system = `You are EDDIE's dream cycle processor. Analyze today's conversations and extract valuable insights worth remembering long-term.

Extract 3-7 atomic insights as a JSON array of strings. Each insight should be:
- A clear, third-person statement (e.g. "Nicholas prefers TypeScript functional style over OOP")
- Specific and actionable, not generic
- Something worth remembering across sessions

Respond with ONLY a JSON array: ["insight 1", "insight 2", ...]
If there are no valuable insights, return [].`;

  const { text, ok } = await runPromptMulti({
    provider: "gemini",
    system,
    prompt: `Today's conversations:\n${conversations}`,
    source: "dream-extract",
  });
  if (!ok) return [];
  return parseJsonFromLLM<string[]>(text, []);
}

async function deduplicateInsights(insights: string[]): Promise<string[]> {
  if (!memoryEnabled) return insights;
  const novel: string[] = [];
  for (const insight of insights) {
    try {
      const results = await searchMemory(insight, 3, 0.85);
      if (results.length === 0) {
        novel.push(insight);
      } else {
        logger.debug("dream:duplicate-skipped", {
          insight: insight.slice(0, 50),
        });
      }
    } catch {
      novel.push(insight);
    }
  }
  return novel;
}

async function cleanStaleHourlyFacts(): Promise<void> {
  if (!memoryEnabled) return;
  try {
    const cutoff = new Date(
      Date.now() - 90 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await getSupabase()
      .from("facts")
      .update({ active: false })
      .eq("source", "hourly-state")
      .lt("created_at", cutoff);
  } catch (err) {
    logger.warn("dream:stale-cleanup-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function rotateArchives(): Promise<void> {
  try {
    const dirs = await readdir(BRAIN_VAULT);
    for (const dir of dirs) {
      const dirPath = resolve(BRAIN_VAULT, dir);
      const stats = await stat(dirPath);
      if (!stats.isDirectory()) continue;

      if (
        dir.startsWith(".") ||
        dir === "00 - Inbox" ||
        dir === "90 - Agent Memory"
      )
        continue;

      const archivePath = resolve(dirPath, "_archive");
      try {
        const archiveStats = await stat(archivePath);
        if (!archiveStats.isDirectory()) continue;

        const archiveDirs = await readdir(archivePath);
        const now = Date.now();
        for (const archiveDir of archiveDirs) {
          const archiveDirPath = resolve(archivePath, archiveDir);
          const archiveDirStats = await stat(archiveDirPath);
          if (!archiveDirStats.isDirectory()) continue;

          const ageMs = now - archiveDirStats.mtime.getTime();
          const ageDays = ageMs / (24 * 60 * 60 * 1000);
          if (ageDays > 90) {
            const timestamp = archiveDirStats.mtime.toISOString().split("T")[0];
            const movedName = `${timestamp}-${archiveDir}`;
            await rename(archiveDirPath, resolve(archivePath, movedName));
            logger.info("dream:archive-rotated", {
              dir,
              archiveDir,
              movedName,
              ageDays: Math.round(ageDays),
            });
          }
        }
      } catch {
        // No archive dir, skip
      }
    }
  } catch (err) {
    logger.warn("dream:archive-rotation-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function writeJournal(
  date: string,
  conversations: string,
  insights: string[],
  stored: string[],
): Promise<void> {
  const dir = resolve(BRAIN_VAULT, "90 - Agent Memory/Learnings");
  const path = resolve(dir, `${date}-eddie-journal.md`);
  const content = [
    `# EDDIE Dream Journal — ${date}`,
    "",
    `**Generated:** ${new Date().toISOString()}`,
    `**Conversations processed:** ${conversations.split("\n").length} lines`,
    `**Novel insights stored:** ${stored.length}/${insights.length}`,
    "",
    "## Insights Extracted",
    ...insights.map((i, n) => `${n + 1}. ${i}`),
    "",
    "## Stored to Memory",
    stored.length > 0
      ? stored.map((i) => `- ${i}`).join("\n")
      : "_All insights were duplicates_",
  ].join("\n");

  try {
    await Bun.write(path, content);
    logger.info("dream:journal-written", { path });
  } catch (err) {
    logger.error("dream:journal-write-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function runDreamCycle(bot?: import("gramio").Bot): Promise<void> {
  logger.info("dream:cycle-start");
  const conversations = await getYesterdayConversations();
  const insights = await extractLearnings(conversations);

  if (insights.length === 0) {
    logger.info("dream:no-insights");
    await cleanStaleHourlyFacts();
    await rotateArchives();
    return;
  }

  const novel = await deduplicateInsights(insights);

  for (const insight of novel) {
    await storeFact(insight, "learning", "dream-cycle");
  }

  // Verify vector facts were stored by searching for a recent insight
  if (memoryEnabled && novel.length > 0) {
    try {
      const probe = novel[0]!.slice(0, 60);
      const results = await searchMemory(probe, 1, 0.7);
      if (results.length === 0) {
        logger.warn("dream:vector-store-verify-failed", {
          probe: probe.slice(0, 40),
          message: "0 results returned after storing facts",
        });
      }
    } catch (err) {
      logger.warn("dream:vector-store-verify-error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const date = new Date().toISOString().split("T")[0]!;
  await writeJournal(date, conversations, insights, novel);

  // Verify journal file was written
  {
    const journalPath = resolve(
      BRAIN_VAULT,
      "90 - Agent Memory/Learnings",
      `${date}-eddie-journal.md`,
    );
    const exists = await Bun.file(journalPath).exists();
    if (!exists) {
      logger.warn("dream:journal-verify-failed", {
        path: journalPath,
        message: "Journal file not found after write",
      });
    }
  }
  await cleanStaleHourlyFacts();

  // Archive old daily brief files (> 7 days)
  try {
    const stateDir = resolve(BRAIN_VAULT, "90 - Agent Memory/State");
    const archiveDir = resolve(BRAIN_VAULT, "90 - Agent Memory/_archive");
    await mkdir(archiveDir, { recursive: true });

    const files = await readdir(stateDir);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith("daily-brief-")) continue;
      const filePath = resolve(stateDir, file);
      const info = await stat(filePath);
      if (info.mtimeMs < sevenDaysAgo) {
        await rename(filePath, resolve(archiveDir, file));
        logger.info("dream:archived-brief", { file });
      }
    }
  } catch (err) {
    logger.warn("dream:archive-error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Rotate project archives
  await rotateArchives();

  // Weekly outcome analysis — runs every Sunday regardless of SELF_IMPROVE_ENABLED
  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 0) {
    const { runOutcomeAnalysis } = await import("./outcome-analysis.ts");
    await runOutcomeAnalysis().catch((err) =>
      logger.warn("dream:outcome-analysis-error", { error: String(err) }),
    );

    if (bot) {
      const { runRejectionLearning } = await import("./rejection-learning.ts");
      await runRejectionLearning(bot).catch((e) =>
        logger.warn("dream:rejection-learning-failed", {
          e: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }

  // Self-improvement: extract rejection learnings nightly, weekly analysis on configured day
  if (config.SELF_IMPROVE_ENABLED) {
    const {
      extractRejectionLearnings,
      runWeeklyAnalysis,
      generatePromptRewrites,
    } = await import("./self-improve.ts");
    await extractRejectionLearnings().catch((err) =>
      logger.warn("dream:rejection-learnings-error", { error: String(err) }),
    );
    await generatePromptRewrites().catch((err) =>
      logger.warn("dream:prompt-rewrites-error", { error: String(err) }),
    );
    const dayOfWeek = new Date().getDay();
    if (dayOfWeek === config.SELF_IMPROVE_WEEKLY_DAY) {
      await runWeeklyAnalysis().catch((err) =>
        logger.warn("dream:weekly-analysis-error", { error: String(err) }),
      );
    }
  }

  logger.info("dream:cycle-done", {
    total: insights.length,
    stored: novel.length,
  });
}

export function startDreamCycle(
  bot: import("gramio").Bot,
  time = "02:00",
): void {
  const { hour, minute } = parseTime(time);
  const delay = msUntilTime(hour, minute, config.TIMEZONE);
  logger.info("dream:scheduled", { time, delayMs: delay });

  const handleDreamError = (err: unknown): void => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("dream:cycle-error", { error: errorMsg });
    import("../jobs/self-heal.ts")
      .then(({ triggerSelfHeal }) =>
        triggerSelfHeal(
          {
            source: "dream",
            name: "cycle",
            error: errorMsg,
            timestamp: Date.now(),
          },
          bot,
        ),
      )
      .catch(() => {});
  };

  const runMonthlyIfNeeded = (): void => {
    import("./monthly-review.ts")
      .then(({ isMonthlyReviewDay, runMonthlyReview }) => {
        if (isMonthlyReviewDay()) {
          runMonthlyReview(bot, config.OWNER_TELEGRAM_ID).catch((err) =>
            logger.warn("dream:monthly-review-error", { error: String(err) }),
          );
        }
      })
      .catch(() => {});
  };

  setTimeout(() => {
    runDreamCycle(bot).catch(handleDreamError);
    runMonthlyIfNeeded();
    setInterval(
      () => {
        runDreamCycle(bot).catch(handleDreamError);
        runMonthlyIfNeeded();
      },
      24 * 60 * 60 * 1000,
    );
  }, delay);
}
