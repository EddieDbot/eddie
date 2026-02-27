import type { Bot } from "gramio";
import { config } from "../config.ts";
import { runPromptMulti, parseJsonFromLLM } from "../llm/run-prompt-multi.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { listAgents } from "../agents/registry.ts";
import { createJob } from "../jobs/manager.ts";
import { spawnJob } from "../jobs/tmux.ts";
import { logger } from "../utils/logger.ts";

type WheelSession = {
  topic: string;
  startedAt: number;
  jobsSpawned: number;
  jobIds: string[];
};

const activeSession: { current: WheelSession | null } = { current: null };

export function isWheelActive(): boolean {
  return activeSession.current !== null;
}

export function stopWheel(): WheelSession | null {
  const session = activeSession.current;
  activeSession.current = null;
  return session;
}

async function getActiveGoals(): Promise<string[]> {
  if (!memoryEnabled) return [];
  try {
    const { data } = await getSupabase()
      .from("facts")
      .select("content")
      .eq("category", "goal")
      .eq("active", true);
    return data?.map((g: { content: string }) => g.content) ?? [];
  } catch {
    return [];
  }
}

async function planTasks(
  topic: string,
  agentSlugs: string[],
): Promise<string[]> {
  const agentList = agentSlugs.slice(0, 20).join(", ");
  const system = `You are EDDIE's autonomous planning engine. Given a topic or goal, generate 1-3 specific, actionable task prompts to spawn as background jobs. Available specialized agents: ${agentList}.

Each task should be self-contained — a complete prompt that a background Claude Code agent can execute without additional context.

Respond with ONLY a JSON array of strings (the task prompts): ["task 1 prompt", "task 2 prompt"]
Generate at most ${config.WHEEL_MAX_JOBS} tasks.`;

  const { text, ok } = await runPromptMulti({
    system,
    prompt: `Plan tasks for: ${topic}`,
    maxWaitMs: 20_000,
    source: "wheel",
  });
  if (!ok) return [`Work on: ${topic}`];
  const tasks = parseJsonFromLLM<string[]>(text, []);
  return tasks.filter((t) => typeof t === "string" && t.length > 10);
}

export async function startWheel(bot: Bot, topic?: string): Promise<void> {
  if (activeSession.current) {
    await bot.api.sendMessage({
      chat_id: config.OWNER_TELEGRAM_ID,
      text: "Wheel is already active. Use /wheel stop to disengage first.",
    });
    return;
  }

  let resolvedTopic = topic ?? "";

  if (!resolvedTopic) {
    const goals = await getActiveGoals();
    if (goals.length === 0) {
      await bot.api.sendMessage({
        chat_id: config.OWNER_TELEGRAM_ID,
        text: "No active goals and no topic provided. Set a goal first or use /wheel <topic>.",
      });
      return;
    }
    resolvedTopic = goals.join("; ");
  }

  const agents = await listAgents();
  const agentSlugs = agents.map((a) => a.slug);
  const tasks = await planTasks(resolvedTopic, agentSlugs);

  const tasksToRun = tasks.slice(0, config.WHEEL_MAX_JOBS);

  activeSession.current = {
    topic: resolvedTopic,
    startedAt: Date.now(),
    jobsSpawned: 0,
    jobIds: [],
  };

  const spawnedIds: string[] = [];
  const summaries: string[] = [];

  for (const taskPrompt of tasksToRun) {
    try {
      const job = await createJob("claude", taskPrompt);
      await spawnJob(job);
      activeSession.current.jobsSpawned++;
      activeSession.current.jobIds.push(job.id);
      spawnedIds.push(job.id);
      summaries.push(`#${job.id}: ${taskPrompt.slice(0, 80)}...`);
      logger.info("wheel:job-spawned", { jobId: job.id });
    } catch (err) {
      logger.error("wheel:spawn-error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const msg = [
    `Wheel engaged for: "${resolvedTopic.slice(0, 100)}"`,
    `Spawned ${spawnedIds.length} job(s):`,
    ...summaries,
    "",
    "Send /wheel stop to disengage.",
  ].join("\n");

  await bot.api.sendMessage({ chat_id: config.OWNER_TELEGRAM_ID, text: msg });
  logger.info("wheel:started", {
    topic: resolvedTopic,
    jobs: spawnedIds.length,
  });
}
