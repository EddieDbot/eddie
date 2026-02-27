import { logger } from "../utils/logger.ts";
import { createJob, updateJob } from "./manager.ts";
import { spawnJob, readOutput, wrapPromptForModel } from "./tmux.ts";
import type { Job, ModelId } from "./types.ts";
import { runPromptMulti } from "../llm/run-prompt-multi.ts";

export type ParallelResult = {
  groupId: string;
  jobs: Job[];
  models: ModelId[];
};

export function selectModels(
  prompt: string,
  explicitModels?: ModelId[],
): ModelId[] {
  if (explicitModels && explicitModels.length > 0) return explicitModels;

  const lower = prompt.toLowerCase();
  const models: ModelId[] = ["claude"];

  if (
    /math|proof|logic puzzle|equation|calculus|aime|competition math/.test(
      lower,
    )
  ) {
    models.push("codex");
  }
  if (
    /codebase|entire repo|whole file|video|timestamp|large context/.test(lower)
  ) {
    models.push("gemini");
  }
  if (
    /screenshot|ui from|design to code|chinese|中文|mandarin|bulk|batch/.test(
      lower,
    )
  ) {
    models.push("kimi");
  }

  // Default: claude + gemini for general comparison if no specialist matched
  if (models.length === 1) models.push("gemini");

  return [...new Set(models)];
}

export async function runParallelComparison(
  prompt: string,
  models: ModelId[],
  opts?: { synthesize?: boolean; tmuxPrefix?: string },
): Promise<ParallelResult> {
  const groupId = crypto.randomUUID().slice(0, 8);
  const prefix = opts?.tmuxPrefix ?? `cmp-${groupId}`;

  const jobs: Job[] = [];

  for (const model of models) {
    const wrappedPrompt =
      model === "claude" ? prompt : wrapPromptForModel(prompt, model);
    const role: "primary" | "specialist" =
      model === "claude" ? "primary" : "specialist";

    const job = await createJob(model, wrappedPrompt, {
      tmuxPrefix: `${prefix}-${model}`,
    });

    await updateJob(job.id, {
      parallelGroupId: groupId,
      parallelRole: role,
    });
    job.parallelGroupId = groupId;
    job.parallelRole = role;

    await spawnJob(job);
    jobs.push(job);

    logger.info("parallel:job-spawned", {
      groupId,
      jobId: job.id,
      model,
    });
  }

  return { groupId, jobs, models };
}

export async function getParallelGroupStatus(groupId: string): Promise<{
  total: number;
  completed: number;
  failed: number;
  allDone: boolean;
}> {
  const { getSupabase, memoryEnabled } = await import("../memory/client.ts");

  if (!memoryEnabled)
    return { total: 0, completed: 0, failed: 0, allDone: false };

  const { data } = await getSupabase()
    .from("jobs")
    .select("status")
    .eq("parallel_group_id", groupId);

  if (!data) return { total: 0, completed: 0, failed: 0, allDone: false };

  const total = data.length;
  const completed = data.filter((r: any) => r.status === "completed").length;
  const failed = data.filter((r: any) => r.status === "failed").length;
  return {
    total,
    completed,
    failed,
    allDone: total > 0 && completed + failed === total,
  };
}

export async function collectParallelOutputs(groupId: string): Promise<
  Array<{
    model: ModelId;
    jobId: string;
    output: string;
    outcome?: string;
  }>
> {
  const { getSupabase, memoryEnabled } = await import("../memory/client.ts");

  if (!memoryEnabled) return [];

  const { data } = await getSupabase()
    .from("jobs")
    .select("id, model, outcome")
    .eq("parallel_group_id", groupId);

  if (!data) return [];

  const results = await Promise.all(
    data.map(async (r: any) => {
      const output = await readOutput(r.id);
      return {
        model: r.model as ModelId,
        jobId: r.id as string,
        output: output || "",
        outcome: (r.outcome as string | undefined) ?? undefined,
      };
    }),
  );

  return results;
}

export async function synthesizeResults(
  prompt: string,
  outputs: Array<{ model: ModelId; output: string; outcome?: string }>,
): Promise<string> {
  const fallback = outputs
    .map((o) => `## ${o.model}\n${o.output.slice(-2000)}`)
    .join("\n\n---\n\n");

  const outputSummaries = outputs
    .filter((o) => o.output.trim())
    .map(
      (o) =>
        `### ${o.model.toUpperCase()} (${o.outcome ?? "unknown"}):\n${o.output.slice(-2000)}`,
    )
    .join("\n\n");

  const { text, ok } = await runPromptMulti({
    system:
      "You are synthesizing outputs from multiple AI models for the same task. Identify the best elements from each response, note where they agree/disagree, and produce a concise synthesis. Be direct — no preamble.",
    prompt: `Original task: ${prompt.slice(0, 300)}\n\nModel outputs:\n${outputSummaries}`,
    source: "parallel",
  });
  if (!ok) return fallback;
  return text || fallback;
}
