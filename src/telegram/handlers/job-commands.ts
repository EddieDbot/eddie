import type { MessageContext } from "./shared.ts";
import { config } from "../../config.ts";
import {
  createJob,
  getRecentJobs,
  updateJob,
  getJob,
} from "../../jobs/manager.ts";
import { spawnJob, killSession } from "../../jobs/tmux.ts";

export async function handleRun(context: MessageContext): Promise<void> {
  const text = context.text?.replace(/^\/run\s*/, "").trim() ?? "";
  if (!text) {
    await context.send(
      "Usage: /run [--model claude|kimi|gemini|codex] [--timeout <minutes>] <prompt>",
    );
    return;
  }

  let model: import("../../jobs/types.ts").ModelId = "claude";
  let timeoutMs: number | undefined;
  let prompt = text;

  // Parse --model flag
  const modelMatch = prompt.match(/^--model\s+(claude|kimi|gemini|codex)\s+/i);
  if (modelMatch) {
    model =
      modelMatch[1]!.toLowerCase() as import("../../jobs/types.ts").ModelId;
    prompt = prompt.slice(modelMatch[0].length).trim();
  }

  // Parse --timeout flag
  const timeoutMatch = prompt.match(/^--timeout\s+(\d+)\s+/i);
  if (timeoutMatch) {
    timeoutMs = parseInt(timeoutMatch[1]!, 10) * 60_000;
    prompt = prompt.slice(timeoutMatch[0].length).trim();
  }

  if (!prompt) {
    await context.send(
      "Usage: /run [--model claude|kimi|gemini|codex] [--timeout <minutes>] <prompt>",
    );
    return;
  }

  // Auto-delegation: if no explicit model, check if a specialist is better
  if (!modelMatch) {
    const { evaluateDelegation } = await import("../../routing/delegate.ts");
    const decision = evaluateDelegation(prompt);
    if (decision.shouldDelegate && decision.targetModel) {
      model = decision.targetModel;
      await context.send(`Auto-delegating to ${model} (${decision.reason}).`);
    }
  }

  const job = await createJob(model, prompt);
  if (timeoutMs) {
    await updateJob(job.id, { timeoutMs });
    job.timeoutMs = timeoutMs;
  }
  await spawnJob(job);
  await context.send(
    `Job #${job.id} started (${model}${timeoutMs ? `, timeout: ${timeoutMs / 60_000}m` : ""}). Session: ${job.tmuxSession}`,
  );
}

export async function handleCompare(context: MessageContext): Promise<void> {
  const text = context.text?.replace(/^\/compare\s*/, "").trim() ?? "";
  if (!text) {
    await context.send(
      "Usage: /compare [--models claude,gemini,kimi,codex] [--synthesize] <prompt>",
    );
    return;
  }

  let prompt = text;
  let explicitModels: import("../../jobs/types.ts").ModelId[] | undefined;
  let synthesize = false;

  // Parse --models flag
  const modelsMatch = prompt.match(/^--models\s+([\w,]+)\s+/i);
  if (modelsMatch) {
    explicitModels = modelsMatch[1]!
      .split(",")
      .map((m) =>
        m.trim().toLowerCase(),
      ) as import("../../jobs/types.ts").ModelId[];
    prompt = prompt.slice(modelsMatch[0].length).trim();
  }

  // Parse --synthesize flag
  if (prompt.startsWith("--synthesize ")) {
    synthesize = true;
    prompt = prompt.slice("--synthesize ".length).trim();
  }

  if (!prompt) {
    await context.send(
      "Usage: /compare [--models claude,gemini,kimi,codex] [--synthesize] <prompt>",
    );
    return;
  }

  try {
    const { runParallelComparison, selectModels } =
      await import("../../jobs/parallel.ts");
    const models = selectModels(prompt, explicitModels);
    const result = await runParallelComparison(prompt, models, { synthesize });
    await context.send(
      `Comparing ${models.join(" vs ")} — group ${result.groupId}. Results will arrive as each job completes.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await context.send(`Compare failed: ${msg}`);
  }
}

export async function handleJobs(context: MessageContext): Promise<void> {
  const jobs = await getRecentJobs(10);
  if (jobs.length === 0) {
    await context.send("No jobs yet.");
    return;
  }
  const lines = jobs.map((j) => {
    const started = new Date(j.startedAt).toLocaleString("en-US", {
      timeZone: config.TIMEZONE,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const dur = j.durationMs ? ` (${Math.round(j.durationMs / 1000)}s)` : "";
    return `#${j.id} | ${j.model} | ${j.status}${dur} | ${started}`;
  });
  await context.send(`Recent jobs:\n${lines.join("\n")}`);
}

export async function handleKill(context: MessageContext): Promise<void> {
  const jobId = context.text?.replace(/^\/kill\s*/, "").trim();
  if (!jobId) {
    await context.send("Usage: /kill <job-id>");
    return;
  }
  const job = await getJob(jobId);
  if (!job) {
    await context.send(`Job #${jobId} not found.`);
    return;
  }
  if (job.status !== "running") {
    await context.send(`Job #${jobId} is not running (status: ${job.status}).`);
    return;
  }
  const killed = await killSession(job.tmuxSession);
  if (killed) {
    await updateJob(jobId, {
      status: "killed",
      completedAt: new Date().toISOString(),
    });
    await context.send(`Job #${jobId} killed.`);
  } else {
    await context.send(`Failed to kill job #${jobId}.`);
  }
}
