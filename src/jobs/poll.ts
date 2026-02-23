import type { Bot } from "gramio";
import { unlink } from "node:fs/promises";
import { config } from "../config.ts";
import {
  getRunningJobs,
  updateJob,
  loadFlatFileRunningJobs,
  markFlatFileJobFailed,
} from "./manager.ts";
import {
  isSessionAlive,
  killSession,
  readOutput,
  getOutputSize,
  JOBS_DIR,
} from "./tmux.ts";
import { memoryEnabled } from "../memory/client.ts";
import { emitEvent } from "../dashboard/server.ts";
import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { parseStreamJson } from "../claude/parser.ts";
import { logUsage } from "../memory/usage.ts";

const ZOMBIE_THRESHOLD_MS = 5 * 60_000; // 5 minutes with 0 bytes output = dead

const PERF_LOG = resolve(
  homedir(),
  "brain-vault/90 - Agent Memory/Learnings/agentic-performance.md",
);

async function assessOutcome(
  prompt: string,
  output: string,
): Promise<{ outcome: string; summary: string }> {
  if (!config.ANTHROPIC_API_KEY) return { outcome: "unknown", summary: "" };
  try {
    const snippet = output.slice(-3000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": config.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        system:
          'Assess this agentic job output. Reply with a JSON object: {"outcome":"success"|"partial"|"failed","summary":"one sentence what was accomplished or why it failed"}. Nothing else.',
        messages: [
          {
            role: "user",
            content: `Task: ${prompt.slice(0, 300)}\n\nOutput tail:\n${snippet}`,
          },
        ],
      }),
    });
    const data = (await res.json()) as {
      content: Array<{ text: string }>;
    };
    const text = data.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as {
      outcome?: string;
      summary?: string;
    };
    return {
      outcome: parsed.outcome ?? "unknown",
      summary: parsed.summary ?? "",
    };
  } catch {
    return { outcome: "unknown", summary: "" };
  }
}

async function appendPerfLog(
  jobId: string,
  prompt: string,
  outcome: string,
  summary: string,
  durationMs: number,
): Promise<void> {
  const date = new Date().toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: config.TIMEZONE,
  });
  const durMin = Math.round(durationMs / 60_000);
  const tag = outcome === "success" ? "✓" : outcome === "partial" ? "⚠" : "✗";
  const entry = `| ${date} | ${jobId} | ${tag} ${outcome} | ${summary || prompt.slice(0, 60)} | ${durMin}m |`;

  const file = Bun.file(PERF_LOG);
  const header =
    "# Agentic Performance Log\n\nTrack Eddie's autonomous job outcomes to tune cadence, briefing quality, and agent selection.\n\n| Date | Job | Outcome | Summary | Duration |\n|------|-----|---------|---------|----------|\n";

  try {
    if (await file.exists()) {
      const content = await file.text();
      const tableStart = content.indexOf("| Date |");
      if (tableStart !== -1) {
        // Insert after header row + separator row
        const afterHeader = content.indexOf("\n", tableStart);
        const afterSep = content.indexOf("\n", afterHeader + 1);
        const newContent =
          content.slice(0, afterSep + 1) +
          entry +
          "\n" +
          content.slice(afterSep + 1);
        await Bun.write(PERF_LOG, newContent);
      } else {
        await Bun.write(PERF_LOG, content + "\n" + entry);
      }
    } else {
      await Bun.write(PERF_LOG, header + entry + "\n");
    }
  } catch (err) {
    logger.warn("jobs:perf-log-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startJobPoller(bot: Bot): void {
  logger.info("jobs:poller-start", { intervalMs: config.JOB_POLL_INTERVAL_MS });

  // Reconcile any jobs that completed while EDDIE was down
  reconcileJobs(bot).catch((err) =>
    logger.error("jobs:reconcile-error", {
      error: err instanceof Error ? err.message : String(err),
    }),
  );

  setInterval(() => {
    pollJobs(bot).catch((err) =>
      logger.error("jobs:poll-error", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }, config.JOB_POLL_INTERVAL_MS);
}

async function pollJobs(bot: Bot): Promise<void> {
  const running = await getRunningJobs();
  if (running.length === 0) return;

  logger.debug("jobs:polling", { count: running.length });

  for (const job of running) {
    // Enforce timeout: kill session if elapsed > timeoutMs
    if (job.timeoutMs) {
      const elapsed = Date.now() - new Date(job.startedAt).getTime();
      if (elapsed > job.timeoutMs) {
        logger.warn("jobs:timeout", {
          id: job.id,
          elapsedMs: elapsed,
          timeoutMs: job.timeoutMs,
        });
        await killSession(job.tmuxSession);
        await timeoutJob(bot, job.id, elapsed);
        continue;
      }
    }

    // Zombie detection: running > 5min with 0 bytes output = dead process
    const elapsed = Date.now() - new Date(job.startedAt).getTime();
    if (elapsed > ZOMBIE_THRESHOLD_MS) {
      const outputSize = await getOutputSize(job.id);
      if (outputSize === 0) {
        logger.warn("jobs:zombie-detected", { id: job.id, elapsedMs: elapsed });
        await killSession(job.tmuxSession);
        await timeoutJob(bot, job.id, elapsed);
        continue;
      }
    }

    const alive = await isSessionAlive(job.tmuxSession);
    if (!alive) {
      await completeJob(bot, job.id);
    }
  }
}

async function reconcileJobs(bot: Bot): Promise<void> {
  // Primary source (Supabase or flat file via getRunningJobs)
  const primaryRunning = await getRunningJobs();
  for (const job of primaryRunning) {
    const alive = await isSessionAlive(job.tmuxSession);
    if (!alive) {
      logger.info("jobs:reconcile-complete", { id: job.id, source: "primary" });
      await completeJob(bot, job.id);
    }
  }

  // Also check flat file when Supabase is primary — catch fallback orphans
  if (memoryEnabled) {
    const primaryIds = new Set(primaryRunning.map((j) => j.id));
    const flatRunning = await loadFlatFileRunningJobs();
    for (const job of flatRunning) {
      if (primaryIds.has(job.id)) continue; // already handled above
      const alive = await isSessionAlive(job.tmuxSession);
      if (!alive) {
        logger.info("jobs:reconcile-flatfile", { id: job.id });
        await markFlatFileJobFailed(job.id);
      }
    }
  }
}

async function timeoutJob(
  bot: Bot,
  jobId: string,
  elapsedMs: number,
): Promise<void> {
  const elapsedMin = Math.round(elapsedMs / 60_000);
  const completedAt = new Date().toISOString();

  const { getJob } = await import("./manager.ts");
  const job = await getJob(jobId);

  await updateJob(jobId, {
    status: "failed",
    completedAt,
    durationMs: elapsedMs,
    error: `Timeout after ${elapsedMin}m`,
    outcome: "failed",
    outcomeSummary: `Killed after exceeding ${elapsedMin}m timeout`,
  });

  await appendPerfLog(
    jobId,
    job?.prompt ?? "",
    "failed",
    `Timeout after ${elapsedMin}m`,
    elapsedMs,
  );

  logger.info("jobs:timed-out", { id: jobId, elapsedMin });
  emitEvent("job:timed-out", { id: jobId, elapsedMin });

  const jobName =
    (job?.prompt ?? "")
      .split("\n")[0]!
      .replace(/^#+\s*/, "")
      .trim()
      .slice(0, 60) || "unnamed";

  try {
    await bot.api.sendMessage({
      chat_id: config.OWNER_TELEGRAM_ID,
      text: `#${jobName} timed out after ${elapsedMin}m and was killed.`,
    });
  } catch (err) {
    logger.error("jobs:notify-error", {
      id: jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Self-heal on timeout
  if (job) {
    const { isHealJob, triggerSelfHeal } = await import("./self-heal.ts");
    if (!isHealJob(job.tmuxSession)) {
      triggerSelfHeal(
        {
          source: "job",
          name:
            (job.prompt.split("\n")[0] ?? "")
              .replace(/^#+\s*/, "")
              .trim()
              .slice(0, 60) || jobId,
          error: `Timeout after ${elapsedMin}m`,
          timestamp: Date.now(),
          jobId,
        },
        bot,
      ).catch(() => {});
    }
  }
}

async function completeJob(bot: Bot, jobId: string): Promise<void> {
  const output = await readOutput(jobId);
  const completedAt = new Date().toISOString();

  // Get job to calculate duration + original prompt
  const { getJob } = await import("./manager.ts");
  const job = await getJob(jobId);
  const durationMs = job ? Date.now() - new Date(job.startedAt).getTime() : 0;
  const durationSec = Math.round(durationMs / 1000);

  // Extract and log token usage from stream-json output
  if (output && job?.model === "claude") {
    const parsed = parseStreamJson(output);
    if (parsed.usage) {
      const INPUT_COST = 3.0 / 1_000_000;
      const OUTPUT_COST = 15.0 / 1_000_000;
      const estCost =
        parsed.usage.totalCostUsd ??
        parsed.usage.inputTokens * INPUT_COST +
          parsed.usage.outputTokens * OUTPUT_COST;
      logUsage({
        model: "claude-sonnet-4-6",
        input_tokens: parsed.usage.inputTokens,
        output_tokens: parsed.usage.outputTokens,
        est_cost_usd: estCost,
        source: "job",
      }).catch(() => {});
    }
  }

  // Assess outcome via haiku
  const { outcome, summary } = await assessOutcome(job?.prompt ?? "", output);

  // Save output to Brain Vault
  const date = completedAt.slice(0, 10);
  const brainVaultDir = config.BRAIN_VAULT_JOBS_DIR.replace(
    "~",
    process.env.HOME ?? "/root",
  );
  const outputPath = resolve(brainVaultDir, `${date}-${jobId}.md`);

  try {
    await Bun.write(
      outputPath,
      `# Job ${jobId}\n\nCompleted: ${completedAt}\nOutcome: ${outcome}${summary ? ` — ${summary}` : ""}\n\n## Output\n\n${output}`,
    );
  } catch (err) {
    logger.warn("jobs:save-output-failed", {
      id: jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await updateJob(jobId, {
    status: "completed",
    completedAt,
    durationMs,
    outputPath,
    outcome,
    outcomeSummary: summary,
  });

  // Append to performance log
  await appendPerfLog(jobId, job?.prompt ?? "", outcome, summary, durationMs);

  logger.info("jobs:completed", { id: jobId, durationMs, outcome });
  emitEvent("job:completed", { id: jobId, durationMs, outcome });

  // Notify via Telegram
  const outcomeTag =
    outcome === "success"
      ? "✓"
      : outcome === "partial"
        ? "⚠ partial"
        : "✗ failed";

  // Extract job name from prompt — strip markdown heading markers, take first 60 chars
  const prompt = job?.prompt ?? "";
  const jobName =
    prompt
      .split("\n")[0]!
      .replace(/^#+\s*/, "")
      .trim()
      .slice(0, 60) || "unnamed";

  const text = `#${jobName} done (${durationSec}s) ${outcomeTag}${summary ? `\n${summary}` : ""}`;
  try {
    await bot.api.sendMessage({ chat_id: config.OWNER_TELEGRAM_ID, text });
  } catch (err) {
    logger.error("jobs:notify-error", {
      id: jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Self-heal on failure
  if (job) {
    const { isHealJob, triggerSelfHeal, resolveHeal } =
      await import("./self-heal.ts");
    if (isHealJob(job.tmuxSession)) {
      resolveHeal(jobId, summary || outcome).catch(() => {});
    } else if (outcome === "failed") {
      triggerSelfHeal(
        {
          source: "job",
          name:
            (job.prompt.split("\n")[0] ?? "")
              .replace(/^#+\s*/, "")
              .trim()
              .slice(0, 60) || jobId,
          error: summary || "job failed",
          timestamp: Date.now(),
          jobId,
          outputTail: output.slice(-2000),
        },
        bot,
      ).catch(() => {});
    }
  }

  // Cleanup temp files
  const promptPath = resolve(JOBS_DIR, `job-${jobId}-prompt.txt`);
  const outputTmpPath = resolve(JOBS_DIR, `job-${jobId}-output.txt`);
  const systemPath = resolve(JOBS_DIR, `job-${jobId}-system.txt`);
  try {
    await unlink(promptPath);
  } catch {
    /* ignore cleanup errors */
  }
  try {
    await unlink(outputTmpPath);
  } catch {
    /* ignore cleanup errors */
  }
  try {
    await unlink(systemPath);
  } catch {
    /* ignore cleanup errors */
  }
}
