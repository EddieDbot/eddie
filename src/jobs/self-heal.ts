import type { Bot } from "gramio";
import { config } from "../config.ts";
import { createJob } from "./manager.ts";
import { spawnJob } from "./tmux.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";
import { emitEvent } from "../dashboard/server.ts";
import type { StepError } from "./types.ts";
import { matchCommonIssue, healRiskLevel } from "./heal-risk.ts";

export type FailureSource =
  | "job"
  | "cron"
  | "heartbeat"
  | "playlist"
  | "dream"
  | "morning-brief"
  | "nightly-orchestrate"
  | "claude-health";

export type FailureContext = {
  source: FailureSource;
  name: string;
  error: string;
  timestamp: number;
  jobId?: string;
  promptSnippet?: string;
  outputTail?: string;
  steps?: StepError[];
  lastStep?: number;
  lastStepName?: string;
  paneCapture?: string;
};

// In-memory rate limiting state
const activeHeals = new Map<string, string>(); // "source:name" -> healJobId
const recentHeals: Array<{ key: string; at: number }> = [];
const cooldowns = new Map<string, number>(); // "source:name" -> last heal timestamp

const COOLDOWN_MS = 30 * 60_000; // 30 min per source
const GLOBAL_CAP = 3; // max heals per rolling hour
const CAP_WINDOW_MS = 60 * 60_000; // 1 hour

const TRANSIENT_PATTERNS = [
  /ECONNRESET/i,
  /\b503\b/,
  /\b429\b/,
  /rate.?limit/i,
  /socket hang up/i,
];

const SOURCE_FILES: Record<FailureSource, string[]> = {
  job: [
    "/home/na/eddie/src/jobs/manager.ts",
    "/home/na/eddie/src/jobs/tmux.ts",
    "/home/na/eddie/src/jobs/poll.ts",
  ],
  cron: ["/home/na/eddie/src/proactive/cron.ts"],
  heartbeat: ["/home/na/eddie/src/proactive/heartbeat.ts"],
  playlist: ["/home/na/eddie/src/proactive/playlist.ts"],
  dream: ["/home/na/eddie/src/proactive/dream.ts"],
  "morning-brief": ["/home/na/eddie/src/proactive/morning-brief.ts"],
  "nightly-orchestrate": [
    "/home/na/eddie/src/proactive/nightly-orchestrate.ts",
  ],
  "claude-health": ["/home/na/eddie/src/proactive/claude-health.ts"],
};

function shouldHeal(ctx: FailureContext, tmuxSession?: string): boolean {
  if (tmuxSession?.startsWith("heal-")) return false;

  const key = `${ctx.source}:${ctx.name}`;
  if (activeHeals.has(key)) return false;

  const lastHeal = cooldowns.get(key);
  if (lastHeal && Date.now() - lastHeal < COOLDOWN_MS) return false;

  const now = Date.now();
  const recentCount = recentHeals.filter(
    (h) => now - h.at < CAP_WINDOW_MS,
  ).length;
  if (recentCount >= GLOBAL_CAP) return false;

  if (TRANSIENT_PATTERNS.some((p) => p.test(ctx.error))) return false;

  return true;
}

function buildHealPrompt(ctx: FailureContext): string {
  const files = SOURCE_FILES[ctx.source] ?? [];
  const fileList = files.map((f) => `- ${f}`).join("\n");

  return `# Self-Heal: ${ctx.source}/${ctx.name}

## Failure Report
- **Source:** ${ctx.source}
- **Name:** ${ctx.name}
- **Error:** ${ctx.error}
- **Time:** ${new Date(ctx.timestamp).toISOString()}${ctx.promptSnippet ? `\n- **Prompt snippet:** ${ctx.promptSnippet}` : ""}

## Output Tail
${ctx.outputTail ?? "(no output available)"}

## Step Progress
${ctx.lastStepName ? `Last step reached: Step ${ctx.lastStep} — ${ctx.lastStepName}` : "(no step markers in output)"}
${ctx.steps && ctx.steps.length > 0 ? `\nStep errors:\n${ctx.steps.map((s) => `- Step ${s.step} (${s.stepName}): ${s.error}`).join("\n")}` : ""}

## Live Terminal (last 200 lines)
${ctx.paneCapture ?? "(not available)"}

## Relevant Source Files
${fileList}

## Task
Diagnose and fix this failure. Steps:
1. Read the relevant source files listed above
2. Identify the root cause (code bug, config issue, external dependency failure, or state corruption)
3. Apply a minimal patch (max 3 files, never modify self-heal.ts itself, never touch credential env vars, never rewrite modules from scratch)
4. Run \`bun check\` in /home/na/eddie to verify types pass
5. Report results

End your response with exactly this line:
HEAL_RESULT: ${ctx.source} | {diagnosis} | {action taken} | restart_needed: yes/no`;
}

export async function triggerSelfHeal(
  ctx: FailureContext,
  bot: Bot,
): Promise<void> {
  if (!config.SELF_HEAL_ENABLED) return;

  const key = `${ctx.source}:${ctx.name}`;

  if (!shouldHeal(ctx)) {
    logger.debug("self-heal:skipped", {
      source: ctx.source,
      name: ctx.name,
      key,
    });
    return;
  }

  // Check common issues first
  const commonIssue = matchCommonIssue(ctx.error);
  if (commonIssue) {
    if (commonIssue.action === "skip_heal") {
      logger.debug("self-heal:common-issue-skip", {
        source: ctx.source,
        diagnosis: commonIssue.diagnosis,
      });
      return;
    }
    if (commonIssue.action === "notify_only") {
      bot.api
        .sendMessage({
          chat_id: config.OWNER_TELEGRAM_ID,
          text: `⚠️ ${ctx.source}/${ctx.name}: ${commonIssue.diagnosis}`,
        })
        .catch(() => {});
      return;
    }
    // auto_fix and run_migration fall through to normal heal
    logger.info("self-heal:common-issue-heal", {
      source: ctx.source,
      diagnosis: commonIssue.diagnosis,
      action: commonIssue.action,
    });
  }

  // Gate high-risk heals behind human approval
  const risk = healRiskLevel(ctx);
  if (risk === "high") {
    try {
      const { requestHumanJudgment } =
        await import("../proactive/confidence.ts");
      const id = await requestHumanJudgment(
        bot,
        `self-heal:${ctx.source}`,
        `${ctx.name}: ${ctx.error.slice(0, 100)}`,
        30,
        { ctx },
      );
      if (id) {
        logger.info("self-heal:high-risk-gated", {
          source: ctx.source,
          judgmentId: id,
        });
        return;
      }
    } catch {
      // Fall through to normal heal
    }
  }

  const prompt = buildHealPrompt(ctx);

  try {
    const job = await createJob("claude", prompt, {
      tmuxPrefix: "heal",
      timeoutMs: 600_000,
    });
    await spawnJob(job);

    activeHeals.set(key, job.id);
    cooldowns.set(key, Date.now());
    recentHeals.push({ key, at: Date.now() });

    // Trim old entries outside cap window
    const cutoff = Date.now() - CAP_WINDOW_MS;
    while (recentHeals.length > 0 && recentHeals[0]!.at < cutoff) {
      recentHeals.shift();
    }

    logger.info("self-heal:triggered", {
      source: ctx.source,
      name: ctx.name,
      healJobId: job.id,
    });
    emitEvent("self-heal:triggered", {
      source: ctx.source,
      name: ctx.name,
      healJobId: job.id,
    });

    if (memoryEnabled) {
      getSupabase()
        .from("self_heal_log")
        .insert({
          source: ctx.source,
          name: ctx.name,
          error: ctx.error.slice(0, 500),
          heal_job_id: job.id,
          status: "triggered",
        })
        .then(({ error }) => {
          if (error)
            logger.warn("self-heal:log-error", { error: error.message });
        });
    }

    bot.api
      .sendMessage({
        chat_id: config.OWNER_TELEGRAM_ID,
        text: `🔧 self-heal triggered\nsource: ${ctx.source}/${ctx.name}\nerror: ${ctx.error.slice(0, 120)}`,
      })
      .catch(() => {});
  } catch (err) {
    logger.error("self-heal:spawn-error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function resolveHeal(
  jobId: string,
  outcome: string,
): Promise<void> {
  for (const [key, healJobId] of activeHeals) {
    if (healJobId === jobId) {
      activeHeals.delete(key);
      logger.info("self-heal:resolved", { jobId, outcome, key });
      break;
    }
  }

  if (memoryEnabled) {
    getSupabase()
      .from("self_heal_log")
      .update({ status: "resolved", outcome: outcome.slice(0, 500) })
      .eq("heal_job_id", jobId)
      .then(({ error }) => {
        if (error)
          logger.warn("self-heal:resolve-log-error", { error: error.message });
      });
  }
}

export function isHealJob(tmuxSession: string): boolean {
  return tmuxSession.startsWith("heal-");
}
