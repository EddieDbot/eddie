/**
 * Leaf Task Executor
 *
 * Dispatches N independent tasks to N model instances in parallel.
 * Different from runParallelComparison (same prompt → many models).
 * This runs DIFFERENT prompts, potentially on the SAME model multiple times.
 *
 * Usage:
 *   const results = await dispatchLeafTasks([
 *     { prompt: "write a slug() helper", model: "kimi", label: "slug-helper" },
 *     { prompt: "write a formatDate() util", model: "kimi", label: "date-util" },
 *     { prompt: "research rate limiting strategies", model: "gemini", label: "rate-limit-research" },
 *   ]);
 *
 * Spawn as many instances as needed — each gets its own tmux session.
 * Claude synthesizes results when all complete.
 */

import { createJob } from "./manager.ts";
import { spawnJob } from "./tmux.ts";
import { logger } from "../utils/logger.ts";
import type { ModelId } from "./types.ts";

export type LeafTask = {
  prompt: string;
  model: ModelId;
  label?: string;
};

export type LeafResult = {
  label: string;
  model: ModelId;
  jobId: string;
  sessionName: string;
};

export type LeafBatch = {
  batchId: string;
  results: LeafResult[];
  totalTasks: number;
};

/**
 * Dispatch N leaf tasks in parallel across any combination of models.
 * Each task gets its own tmux session. Returns immediately after spawning.
 * Use pollLeafBatch() to wait for completion, or let Claude collect outputs.
 */
export async function dispatchLeafTasks(
  tasks: LeafTask[],
  opts?: { batchLabel?: string },
): Promise<LeafBatch> {
  const batchId = crypto.randomUUID().slice(0, 8);
  const batchLabel = opts?.batchLabel ?? `leaf-${batchId}`;
  const results: LeafResult[] = [];

  // Spawn all in parallel — no sequential waiting
  await Promise.all(
    tasks.map(async (task, i) => {
      const label = task.label ?? `task-${i}`;
      const sessionPrefix = `${batchLabel}-${label}`;

      const job = await createJob(task.model, task.prompt, {
        tmuxPrefix: sessionPrefix,
        namespace: batchLabel,
      });

      await spawnJob(job);

      results.push({
        label,
        model: task.model,
        jobId: job.id,
        sessionName: job.tmuxSession ?? sessionPrefix,
      });

      logger.info("leaf-executor:spawned", {
        batchId,
        label,
        model: task.model,
        jobId: job.id,
      });
    }),
  );

  logger.info("leaf-executor:batch-launched", {
    batchId,
    totalTasks: tasks.length,
    models: [...new Set(tasks.map((t) => t.model))],
  });

  return { batchId, results, totalTasks: tasks.length };
}

/**
 * Auto-assign models to a list of prompts based on detectOptimalModel routing.
 * Useful when you have leaf tasks but don't want to manually specify models.
 */
export async function autoDispatchLeafTasks(
  prompts: { prompt: string; label?: string }[],
  opts?: { batchLabel?: string },
): Promise<LeafBatch> {
  const { detectOptimalModel } = await import("./settings.ts");

  const tasks: LeafTask[] = prompts.map((p) => ({
    prompt: p.prompt,
    model: detectOptimalModel(p.prompt, "claude"),
    label: p.label,
  }));

  return dispatchLeafTasks(tasks, opts);
}
