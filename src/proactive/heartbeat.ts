import type { Bot } from "gramio";
import { config } from "../config.ts";
import { relayHeartbeat } from "../claude/relay.ts";
import { canSendProactive, logProactiveSend } from "./anti-spam.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logCommunication } from "../memory/store.ts";
import { initiateCall } from "../voice/call.ts";
import { logger } from "../utils/logger.ts";
import { emitEvent } from "../dashboard/server.ts";
import {
  parseConfidence,
  getPendingEscalations,
  clearEscalation,
} from "./confidence.ts";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { STATE_DIR } from "../memory/brain-vault-paths.ts";
import { readdir } from "node:fs/promises";
import { buildUsageBlock } from "../memory/usage.ts";
import { evaluateTaskAlignment } from "./vision.ts";
import { getQueueStats, getNextTask } from "./task-queue.ts";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");

const SKIP_STATE_FILES = new Set([
  "system-overview",
  "eddie-current",
  "claude-code-component-catalog",
]);

async function getProjectStates(): Promise<string> {
  try {
    const files = await readdir(STATE_DIR);
    const mdFiles = files.filter(
      (f) => f.endsWith(".md") && !f.endsWith(".bak"),
    );
    const summaries: string[] = [];

    for (const file of mdFiles) {
      const slug = file.replace(/\.md$/, "");
      if (SKIP_STATE_FILES.has(slug)) continue;
      try {
        const content = await Bun.file(resolve(STATE_DIR, file)).text();
        // Extract first 600 chars — enough to capture last-updated, status, current phase
        const excerpt = content
          .slice(0, 600)
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        summaries.push(`### ${slug}\n${excerpt}\n---`);
      } catch {
        // skip unreadable
      }
    }

    return summaries.length > 0
      ? summaries.join("\n")
      : "No project state files found.";
  } catch {
    return "Could not read project states.";
  }
}

type HeartbeatDecision = {
  action: "ok" | "message" | "call" | "task" | "personal" | "queue-task";
  text?: string;
  callReason?: string;
  taskGoal?: string;
  taskDescription?: string;
  queueTaskId?: string;
};

function nowInTimezone(timezone: string): Date {
  const str = new Date().toLocaleString("en-US", { timeZone: timezone });
  return new Date(str);
}

function isQuietHours(): boolean {
  const now = nowInTimezone(config.TIMEZONE);
  const hour = now.getHours();
  const quietStart = config.PROACTIVE_QUIET_START;
  const quietEnd = config.PROACTIVE_QUIET_END;
  if (quietStart > quietEnd) {
    return hour >= quietStart || hour < quietEnd;
  }
  return hour >= quietStart && hour < quietEnd;
}

async function loadChecklist(): Promise<string> {
  const path = resolve(PROJECT_ROOT, "HEARTBEAT.md");
  try {
    const file = Bun.file(path);
    return await file.text();
  } catch {
    return "No HEARTBEAT.md found. Default: check for inactivity and active goals.";
  }
}

export function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function getLastHeartbeatAt(): Promise<string | null> {
  if (!memoryEnabled) return null;
  try {
    const { data } = await getSupabase()
      .from("heartbeat_log")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1);
    return data?.[0]?.created_at ?? null;
  } catch {
    return null;
  }
}

async function getLastHeartbeats(limit = 3): Promise<string> {
  if (!memoryEnabled) return "No heartbeat history (memory not configured).";
  try {
    const { data, error } = await getSupabase()
      .from("heartbeat_log")
      .select("decision, summary, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data || data.length === 0) return "No previous heartbeats.";
    return data
      .map(
        (h) =>
          `- ${relativeTime(h.created_at)}: ${h.decision}${h.summary ? ` — ${h.summary}` : ""}`,
      )
      .join("\n");
  } catch {
    return "Could not fetch heartbeat history.";
  }
}

async function getActiveGoals(): Promise<string> {
  if (!memoryEnabled) return "Memory not configured.";
  try {
    const { data, error } = await getSupabase()
      .from("facts")
      .select("content")
      .eq("category", "goal")
      .eq("active", true);
    if (error || !data || data.length === 0) return "No active goals.";
    return data.map((g) => `- ${g.content}`).join("\n");
  } catch {
    return "Could not fetch goals.";
  }
}

async function getRecentConversations(): Promise<string> {
  if (!memoryEnabled) return "Memory not configured.";
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await getSupabase()
      .from("conversations")
      .select("role, content, created_at")
      .gte("created_at", dayAgo)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error || !data || data.length === 0)
      return "No conversations in the last 24 hours.";
    return data
      .map((c) => {
        const truncated =
          c.content.length > 200 ? c.content.slice(0, 200) + "..." : c.content;
        return `- ${relativeTime(c.created_at)} [${c.role}]: ${truncated}`;
      })
      .join("\n");
  } catch {
    return "Could not fetch conversations.";
  }
}

async function getLastActivityTime(): Promise<string> {
  if (!memoryEnabled) return "Unknown (memory not configured).";
  try {
    const { data, error } = await getSupabase()
      .from("communication_log")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return "No recorded activity.";
    return relativeTime(data[0]!.created_at);
  } catch {
    return "Could not determine last activity.";
  }
}

async function getDueCronSummary(): Promise<string> {
  try {
    const { getDueCronJobs } = await import("./cron.ts");
    const jobs = await getDueCronJobs();
    if (jobs.length === 0) return "No due cron jobs.";
    return jobs
      .map((j) => `- [${j.name}] ${j.prompt.slice(0, 100)}`)
      .join("\n");
  } catch {
    return "Cron module not available.";
  }
}

async function goalTaskSpawnedToday(): Promise<boolean> {
  if (!memoryEnabled) return false;
  try {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const { data } = await getSupabase()
      .from("heartbeat_log")
      .select("id")
      .eq("decision", "task")
      .gte("created_at", since.toISOString())
      .limit(1);
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function getPendingProactiveActions(): Promise<string> {
  try {
    const modelPath = resolve(
      homedir(),
      "brain-vault/90 - Agent Memory/State/world-model.json",
    );
    const raw = await Bun.file(modelPath).text();
    const model = JSON.parse(raw);
    const actions: any[] = model.proactiveActions ?? [];
    if (actions.length === 0) return "";
    return [
      "## Nightly Orchestrate Suggestions",
      ...actions.map(
        (a: any) =>
          `- [${a.priority}] ${a.description}${a.suggestedAgent ? ` (suggested agent: ${a.suggestedAgent})` : ""}${a.targetProject ? ` — project: ${a.targetProject}` : ""}`,
      ),
    ].join("\n");
  } catch {
    return "";
  }
}

async function buildHeartbeatContext(): Promise<string> {
  const now = nowInTimezone(config.TIMEZONE);
  const timeStr = now.toLocaleString("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: config.TIMEZONE,
  });

  const lastHeartbeatAt = await getLastHeartbeatAt();

  const [
    checklist,
    lastBeats,
    goals,
    convos,
    lastActivity,
    dueCrons,
    projectStates,
    usageBlock,
    proactiveActions,
    queueStats,
    nextTask,
  ] = await Promise.all([
    loadChecklist(),
    getLastHeartbeats(),
    getActiveGoals(),
    getRecentConversations(),
    getLastActivityTime(),
    getDueCronSummary(),
    getProjectStates(),
    buildUsageBlock(lastHeartbeatAt, config.TIMEZONE).catch(
      () => "Usage data unavailable.",
    ),
    getPendingProactiveActions(),
    config.KANBAN_ENABLED ? getQueueStats().catch(() => null) : null,
    config.KANBAN_ENABLED ? getNextTask().catch(() => null) : null,
  ]);

  const agentSummary = `## Agent Routing
Jobs auto-inject relevant agents based on task content via the capability routing layer.
Core agents always available: self-healer (errors), code-reviewer (code), security-reviewer (installs), architect (design), project-orchestrator (audits).
Platform agents: clay, dripify, instantly, attio, n8n, cal-com — triggered by project/platform keywords.`;

  return [
    `Current time: ${timeStr} (${config.TIMEZONE})`,
    "",
    "## Checklist",
    checklist,
    "",
    "## Recent Heartbeats",
    lastBeats,
    "",
    "## Active Goals",
    goals,
    "",
    "## Last Activity",
    `Last recorded activity: ${lastActivity}`,
    "",
    "## Recent Conversations (last 24h)",
    convos,
    "",
    "## Due Cron Jobs",
    dueCrons,
    "",
    "## Usage",
    usageBlock,
    "",
    "## Current Project States (live from Brain Vault — authoritative, read before acting)",
    "IMPORTANT: Use ONLY this data to assess project health. Ignore any prior knowledge about project status.",
    projectStates,
    "",
    agentSummary,
    "",
    ...(proactiveActions ? [proactiveActions, ""] : []),
    ...(config.KANBAN_ENABLED
      ? [
          "",
          "## Task Queue",
          `Stats: ${JSON.stringify(queueStats ?? {})}`,
          nextTask
            ? `Next ready task: [${nextTask.id}] ${nextTask.title}${nextTask.description ? ` — ${nextTask.description}` : ""}`
            : "No ready tasks.",
          `To execute a queued task: respond with HEARTBEAT_QUEUE_TASK:{"taskId":"<uuid>"}`,
          "",
        ]
      : []),
    "## Goal Task Option",
    'You may also respond with HEARTBEAT_TASK:{"goal":"<active goal>","task":"<specific task prompt>"} to spawn an autonomous background job. Write the task prompt as a full briefing — include which agent(s) to use by slug, what project path to work in, and what done looks like. Base your decision on the CURRENT project states above, not assumptions. Only spawn if there is clear actionable mechanical work, no job is already running for this goal, and you haven\'t spawned one today.',
  ].join("\n");
}

export function parseResponse(text: string): HeartbeatDecision {
  const { text: trimmed } = parseConfidence(text.trim());
  if (trimmed === "HEARTBEAT_OK" || trimmed.startsWith("HEARTBEAT_OK")) {
    return { action: "ok" };
  }
  if (trimmed.startsWith("HEARTBEAT_CALL:")) {
    return {
      action: "call",
      callReason: trimmed.slice("HEARTBEAT_CALL:".length).trim(),
    };
  }
  if (trimmed.startsWith("HEARTBEAT_PERSONAL:")) {
    return {
      action: "personal",
      text: trimmed.slice("HEARTBEAT_PERSONAL:".length).trim(),
    };
  }
  if (trimmed.startsWith("HEARTBEAT_TASK:")) {
    try {
      const payload = JSON.parse(
        trimmed.slice("HEARTBEAT_TASK:".length).trim(),
      ) as { goal: string; task: string };
      return {
        action: "task",
        taskGoal: payload.goal,
        taskDescription: payload.task,
      };
    } catch {
      return { action: "ok" };
    }
  }
  if (trimmed.startsWith("HEARTBEAT_QUEUE_TASK:")) {
    try {
      const payload = JSON.parse(
        trimmed.slice("HEARTBEAT_QUEUE_TASK:".length).trim(),
      ) as { taskId: string };
      return { action: "queue-task", queueTaskId: payload.taskId };
    } catch {
      return { action: "ok" };
    }
  }
  return { action: "message", text: trimmed };
}

async function logHeartbeat(
  decision: string,
  summary: string | null,
  messageSent: string | null,
  durationMs: number,
  usageSnapshot?: string,
): Promise<void> {
  if (!memoryEnabled) return;
  try {
    const { error } = await getSupabase()
      .from("heartbeat_log")
      .insert({
        decision,
        summary,
        message_sent: messageSent,
        duration_ms: durationMs,
        ...(usageSnapshot && { usage_snapshot: usageSnapshot }),
      });
    if (error) logger.error("heartbeat:log", { error: error.message });
  } catch (err) {
    logger.error("heartbeat:log-error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function executeDueCronJobs(bot: Bot): Promise<void> {
  try {
    const { getDueCronJobs, executeCronJob } = await import("./cron.ts");
    const jobs = await getDueCronJobs();
    for (const job of jobs) {
      await executeCronJob(job, bot);
    }
  } catch (err) {
    logger.warn("heartbeat:cron-skip", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function flushPendingEscalations(bot: Bot): Promise<void> {
  const escalations = getPendingEscalations();
  if (escalations.length === 0) return;

  for (let i = escalations.length - 1; i >= 0; i--) {
    const esc = escalations[i]!;
    const targetChatId = esc.chatId ?? config.OWNER_TELEGRAM_ID;
    try {
      await bot.api.sendMessage({
        chat_id: targetChatId,
        text: `Uncertainty check: ${esc.action} — ${esc.reason}. Proceed? Use /approve or /reject.`,
      });
      clearEscalation(i);
      logger.info("heartbeat:escalation-sent", {
        action: esc.action,
        threshold: esc.threshold,
      });
    } catch (err) {
      logger.warn("heartbeat:escalation-send-error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function tick(bot: Bot): Promise<void> {
  const start = Date.now();
  const lastHeartbeatAt = await getLastHeartbeatAt();

  await executeDueCronJobs(bot);
  await flushPendingEscalations(bot);

  const context = await buildHeartbeatContext();
  const result = await relayHeartbeat(context);
  const durationMs = Date.now() - start;

  // Capture usage snapshot for this tick (usage since last heartbeat)
  const usageSnapshot = await buildUsageBlock(
    lastHeartbeatAt,
    config.TIMEZONE,
  ).catch(() => undefined);

  if (result.error) {
    logger.error("heartbeat:relay-error", { error: result.error, durationMs });
    await logHeartbeat(
      "ok",
      `error: ${result.error}`,
      null,
      durationMs,
      usageSnapshot,
    );
    return;
  }

  const decision = parseResponse(result.text);
  logger.info("heartbeat:tick", { action: decision.action, durationMs });
  emitEvent("heartbeat", { action: decision.action, durationMs });

  if (decision.action === "ok") {
    await logHeartbeat("ok", null, null, durationMs, usageSnapshot);
    return;
  }

  // Tasks and calls run 24/7. Only messages are suppressed during quiet hours.
  if (decision.action === "message" && isQuietHours()) {
    logger.debug("heartbeat:quiet-hours-message-suppressed");
    await logHeartbeat(
      "message",
      "suppressed (quiet hours)",
      null,
      durationMs,
      usageSnapshot,
    );
    return;
  }

  const allowed = await canSendProactive();
  if (!allowed) {
    logger.debug("heartbeat:anti-spam-blocked", { action: decision.action });
    await logHeartbeat(
      decision.action,
      "blocked by anti-spam",
      null,
      durationMs,
      usageSnapshot,
    );
    return;
  }

  if (decision.action === "personal" && decision.text) {
    const msg = `🧑 YOUR REPLY NEEDED: ${decision.text}`;
    await bot.api.sendMessage({ chat_id: config.OWNER_TELEGRAM_ID, text: msg });
    await logProactiveSend(
      `[heartbeat:personal] ${decision.text.slice(0, 100)}`,
    );
    if (memoryEnabled) {
      await logCommunication(
        "proactive",
        "outbound",
        `[heartbeat:personal] ${decision.text.slice(0, 100)}`,
      );
    }
    await logHeartbeat(
      "personal",
      decision.text.slice(0, 200),
      msg,
      durationMs,
      usageSnapshot,
    );
  }

  if (decision.action === "message" && decision.text) {
    await bot.api.sendMessage({
      chat_id: config.OWNER_TELEGRAM_ID,
      text: decision.text,
    });
    await logProactiveSend(`[heartbeat] ${decision.text.slice(0, 100)}`);
    if (memoryEnabled) {
      await logCommunication(
        "proactive",
        "outbound",
        `[heartbeat] ${decision.text.slice(0, 100)}`,
      );
    }
    await logHeartbeat(
      "message",
      decision.text.slice(0, 200),
      decision.text,
      durationMs,
      usageSnapshot,
    );
  }

  if (decision.action === "call" && decision.callReason) {
    const phone = config.OWNER_PHONE;
    const webhookUrl = config.TWILIO_WEBHOOK_URL;
    const webhookPort = config.TWILIO_WEBHOOK_PORT;
    if (phone) {
      const webhookBaseUrl = webhookUrl || `https://localhost:${webhookPort}`;
      try {
        await initiateCall(phone, webhookBaseUrl);
        await logProactiveSend(`[heartbeat:call] ${decision.callReason}`);
        await logHeartbeat(
          "call",
          decision.callReason,
          null,
          durationMs,
          usageSnapshot,
        );
      } catch (err) {
        logger.error("heartbeat:call-error", {
          error: err instanceof Error ? err.message : String(err),
        });
        await logHeartbeat(
          "call",
          `call failed: ${err instanceof Error ? err.message : String(err)}`,
          null,
          durationMs,
          usageSnapshot,
        );
      }
    } else {
      logger.warn("heartbeat:call-no-phone", { reason: decision.callReason });
      await logHeartbeat(
        "call",
        "no phone configured",
        null,
        durationMs,
        usageSnapshot,
      );
    }
  }

  if (
    decision.action === "task" &&
    decision.taskDescription &&
    config.GOAL_TASK_ENABLED
  ) {
    const alreadySpawned = await goalTaskSpawnedToday();
    if (alreadySpawned) {
      logger.debug("heartbeat:goal-task-limit-reached");
      await logHeartbeat(
        "ok",
        "goal-task daily limit reached",
        null,
        durationMs,
      );
      return;
    }
    if (config.VISION_ENABLED) {
      const alignment = await evaluateTaskAlignment(
        decision.taskDescription,
      ).catch(() => ({ aligned: true, score: 5, reason: "" }));
      if (!alignment.aligned) {
        logger.info("heartbeat:goal-task-vision-skip", {
          score: alignment.score,
          reason: alignment.reason,
        });
        await logHeartbeat(
          "ok",
          `vision-skip: ${alignment.reason}`,
          null,
          durationMs,
        );
        return;
      }
    }
    try {
      const { createJob } = await import("../jobs/manager.ts");
      const { spawnJob } = await import("../jobs/tmux.ts");
      const job = await createJob("claude", decision.taskDescription);
      await spawnJob(job);
      await bot.api.sendMessage({
        chat_id: config.OWNER_TELEGRAM_ID,
        text: `Auto-started goal task: ${decision.taskGoal ?? "active goal"}\nJob #${job.id} running.`,
      });
      await logHeartbeat(
        "task",
        decision.taskDescription.slice(0, 200),
        null,
        durationMs,
      );
    } catch (err) {
      logger.error("heartbeat:goal-task-error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (
    decision.action === "queue-task" &&
    decision.queueTaskId &&
    config.KANBAN_ENABLED
  ) {
    const { getQueuedTasks, updateTaskState } = await import("./task-queue.ts");
    const tasks = await getQueuedTasks();
    const task = tasks.find((t) => t.id === decision.queueTaskId);
    if (task && task.state === "ready") {
      const prompt = task.description || task.title;
      try {
        const { createJob } = await import("../jobs/manager.ts");
        const { spawnJob } = await import("../jobs/tmux.ts");
        const job = await createJob("claude", prompt);
        await spawnJob(job);
        await updateTaskState(task.id, "running", { jobId: job.id });
        await bot.api.sendMessage({
          chat_id: config.OWNER_TELEGRAM_ID,
          text: `Queue task started: ${task.title}\nJob #${job.id}`,
        });
        await logHeartbeat("queue-task", task.title, null, durationMs);
      } catch (err) {
        logger.error("heartbeat:queue-task-error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return;
  }
}

function getHeartbeatInterval(): number {
  const now = nowInTimezone(config.TIMEZONE);
  const hour = now.getHours();
  const isActive =
    hour >= config.HEARTBEAT_ACTIVE_START && hour < config.HEARTBEAT_ACTIVE_END;
  return isActive
    ? config.HEARTBEAT_ACTIVE_INTERVAL_MS
    : config.HEARTBEAT_IDLE_INTERVAL_MS;
}

export function startHeartbeat(bot: Bot): void {
  logger.info("heartbeat:start", {
    activeIntervalMs: config.HEARTBEAT_ACTIVE_INTERVAL_MS,
    idleIntervalMs: config.HEARTBEAT_IDLE_INTERVAL_MS,
    timezone: config.TIMEZONE,
  });

  function scheduleTick(): void {
    const intervalMs = getHeartbeatInterval();
    setTimeout(async () => {
      try {
        await tick(bot);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error("heartbeat:tick-error", { error: errorMsg });
        const { triggerSelfHeal } = await import("../jobs/self-heal.ts");
        triggerSelfHeal(
          {
            source: "heartbeat",
            name: "tick",
            error: errorMsg,
            timestamp: Date.now(),
          },
          bot,
        ).catch(() => {});
      }
      scheduleTick();
    }, intervalMs);
  }

  // First tick after 10s, then dynamic cadence
  setTimeout(() => {
    tick(bot).catch((err) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("heartbeat:tick-error", { error: errorMsg });
      import("../jobs/self-heal.ts")
        .then(({ triggerSelfHeal }) =>
          triggerSelfHeal(
            {
              source: "heartbeat",
              name: "tick",
              error: errorMsg,
              timestamp: Date.now(),
            },
            bot,
          ),
        )
        .catch(() => {});
    });
    scheduleTick();
  }, 10_000);
}
