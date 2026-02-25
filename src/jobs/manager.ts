import { config } from "../config.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";
import { classifySource, TrustLevel } from "../security/trust.ts";
import type { Job, ModelId } from "./types.ts";

// Fallback flat-file path used only when Supabase is unavailable
const JOBS_FILE = resolve(config.JOBS_DATA_DIR, "jobs.json");

// Generate human-readable session name from prompt
function makeSessionName(
  prompt: string,
  prefix = "job",
  namespace?: string,
): string {
  const words = prompt
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 0)
    .slice(0, 3);

  let base: string;
  if (words.length === 0) {
    const suffix = crypto.randomUUID().slice(0, 4);
    base = `${prefix}-${suffix}`;
  } else {
    const slug = words.join("-").slice(0, 25);
    const suffix = crypto.randomUUID().slice(0, 4);
    base = `${prefix}-${slug}-${suffix}`;
  }

  if (namespace) {
    return `${namespace}-${base}`.slice(0, 32);
  }
  return base;
}

// Map Supabase snake_case row → Job camelCase
function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    model: row.model as ModelId,
    prompt: row.prompt as string,
    status: row.status as Job["status"],
    tmuxSession: row.tmux_session as string,
    outputPath: (row.output_path as string | null) ?? undefined,
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string | null) ?? undefined,
    durationMs: (row.duration_ms as number | null) ?? undefined,
    error: (row.error as string | null) ?? undefined,
    timeoutMs: (row.timeout_ms as number | null) ?? undefined,
    outcome: (row.outcome as string | null) ?? undefined,
    outcomeSummary: (row.outcome_summary as string | null) ?? undefined,
    stepErrors: (row.step_errors as Job["stepErrors"]) ?? undefined,
    lastStep: (row.last_step as number | null) ?? undefined,
    lastStepName: (row.last_step_name as string | null) ?? undefined,
    worktreePath: (row.worktree_path as string | null) ?? undefined,
    artifactCheck:
      (row.artifact_check as Record<string, unknown> | null) ?? undefined,
    parallelGroupId: (row.parallel_group_id as string | null) ?? undefined,
    parallelRole:
      (row.parallel_role as "primary" | "specialist" | null) ?? undefined,
    systemPromptHash: (row.system_prompt_hash as string | null) ?? undefined,
    qaGate:
      (row.qa_gate as { passed: boolean; issues: string[] } | null) ??
      undefined,
    namespace: (row.namespace as string | null) ?? undefined,
    attachments: (row.attachments as string[] | null) ?? undefined,
    sandboxed: (row.sandboxed as boolean | null) ?? undefined,
    trustLevel: (row.trust_level as string | null) ?? undefined,
  };
}

// Map Job camelCase → Supabase snake_case insert/update object
function jobToRow(
  job: Partial<Job> & { id?: string },
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (job.id !== undefined) row.id = job.id;
  if (job.model !== undefined) row.model = job.model;
  if (job.prompt !== undefined) row.prompt = job.prompt;
  if (job.status !== undefined) row.status = job.status;
  if (job.tmuxSession !== undefined) row.tmux_session = job.tmuxSession;
  if (job.outputPath !== undefined) row.output_path = job.outputPath;
  if (job.startedAt !== undefined) row.started_at = job.startedAt;
  if (job.completedAt !== undefined) row.completed_at = job.completedAt;
  if (job.durationMs !== undefined) row.duration_ms = job.durationMs;
  if (job.error !== undefined) row.error = job.error;
  if (job.timeoutMs !== undefined) row.timeout_ms = job.timeoutMs;
  if (job.outcome !== undefined) row.outcome = job.outcome;
  if (job.outcomeSummary !== undefined)
    row.outcome_summary = job.outcomeSummary;
  if (job.stepErrors !== undefined) row.step_errors = job.stepErrors;
  if (job.lastStep !== undefined) row.last_step = job.lastStep;
  if (job.lastStepName !== undefined) row.last_step_name = job.lastStepName;
  if (job.worktreePath !== undefined) row.worktree_path = job.worktreePath;
  if (job.artifactCheck !== undefined) row.artifact_check = job.artifactCheck;
  if (job.parallelGroupId !== undefined)
    row.parallel_group_id = job.parallelGroupId;
  if (job.parallelRole !== undefined) row.parallel_role = job.parallelRole;
  if (job.systemPromptHash !== undefined)
    row.system_prompt_hash = job.systemPromptHash;
  if (job.qaGate !== undefined) row.qa_gate = job.qaGate;
  if (job.namespace !== undefined) row.namespace = job.namespace;
  if (job.attachments !== undefined) row.attachments = job.attachments;
  if (job.sandboxed !== undefined) row.sandboxed = job.sandboxed;
  if (job.trustLevel !== undefined) row.trust_level = job.trustLevel;
  return row;
}

// Flat-file fallback (used when Supabase not configured)
export async function loadJobsFile(): Promise<Job[]> {
  try {
    const file = Bun.file(JOBS_FILE);
    if (!(await file.exists())) return [];
    return await file.json();
  } catch {
    return [];
  }
}

export async function saveJobsFile(jobs: Job[]): Promise<void> {
  await Bun.write(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

export async function loadFlatFileRunningJobs(): Promise<Job[]> {
  const jobs = await loadJobsFile();
  return jobs.filter((j) => j.status === "running");
}

export async function markFlatFileJobFailed(id: string): Promise<void> {
  const jobs = await loadJobsFile();
  const index = jobs.findIndex((j) => j.id === id);
  if (index === -1) return;
  jobs[index] = {
    ...jobs[index]!,
    status: "failed",
    completedAt: new Date().toISOString(),
    error: "Orphaned — reconciled on boot",
  };
  await saveJobsFile(jobs);
}

export async function createJob(
  model: ModelId,
  prompt: string,
  opts?: {
    tmuxPrefix?: string;
    timeoutMs?: number;
    namespace?: string;
    attachments?: string[];
    sandboxed?: boolean;
    trustLevel?: string;
  },
): Promise<Job> {
  const running = await getRunningJobs();
  if (running.length >= config.MAX_CONCURRENT_JOBS) {
    logger.warn("jobs:cap-reached", {
      running: running.length,
      max: config.MAX_CONCURRENT_JOBS,
    });
    throw new Error(
      `Job cap reached: ${running.length}/${config.MAX_CONCURRENT_JOBS} running`,
    );
  }

  // Phase 6: Auto-classify trust level from prompt URLs
  let sandboxed = opts?.sandboxed ?? false;
  let trustLevel = opts?.trustLevel;
  if (config.TRUST_CLASSIFICATION_ENABLED && !trustLevel) {
    const urls = prompt.match(/https?:\/\/[^\s]+/g) ?? [];
    for (const url of urls) {
      const { level } = classifySource(url);
      if (level === TrustLevel.External || level === TrustLevel.Untrusted) {
        sandboxed = true;
        trustLevel = level;
        break;
      }
    }
  }

  const id = crypto.randomUUID().slice(0, 8);
  const job: Job = {
    id,
    model,
    prompt,
    status: "running",
    tmuxSession: makeSessionName(
      prompt,
      opts?.tmuxPrefix ?? "job",
      opts?.namespace,
    ),
    startedAt: new Date().toISOString(),
    ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts?.namespace !== undefined ? { namespace: opts.namespace } : {}),
    ...(opts?.attachments?.length ? { attachments: opts.attachments } : {}),
    ...(sandboxed ? { sandboxed, trustLevel } : {}),
  };

  if (memoryEnabled) {
    const { error } = await getSupabase().from("jobs").insert(jobToRow(job));
    if (error) {
      logger.warn("jobs:create-supabase-error", { error: error.message });
      // Fall through to file fallback
      const jobs = await loadJobsFile();
      jobs.push(job);
      await saveJobsFile(jobs);
    }
  } else {
    const jobs = await loadJobsFile();
    jobs.push(job);
    await saveJobsFile(jobs);
  }

  return job;
}

export async function updateJob(
  id: string,
  patch: Partial<Job>,
): Promise<Job | null> {
  if (memoryEnabled) {
    const row = jobToRow(patch);
    const { data, error } = await getSupabase()
      .from("jobs")
      .update(row)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      logger.warn("jobs:update-supabase-error", { id, error: error.message });
      return null;
    }
    return data ? rowToJob(data as Record<string, unknown>) : null;
  }

  // Flat-file fallback
  const jobs = await loadJobsFile();
  const index = jobs.findIndex((j) => j.id === id);
  if (index === -1) return null;
  jobs[index] = { ...jobs[index]!, ...patch };
  await saveJobsFile(jobs);
  return jobs[index]!;
}

export async function getJob(id: string): Promise<Job | null> {
  if (memoryEnabled) {
    const { data, error } = await getSupabase()
      .from("jobs")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    return rowToJob(data as Record<string, unknown>);
  }
  const jobs = await loadJobsFile();
  return jobs.find((j) => j.id === id) ?? null;
}

export async function getRunningJobs(): Promise<Job[]> {
  if (memoryEnabled) {
    const { data, error } = await getSupabase()
      .from("jobs")
      .select("*")
      .eq("status", "running")
      .order("started_at", { ascending: false });
    if (error) {
      logger.warn("jobs:get-running-supabase-error", { error: error.message });
      return [];
    }
    return (data ?? []).map((r) => rowToJob(r as Record<string, unknown>));
  }
  const jobs = await loadJobsFile();
  return jobs.filter((j) => j.status === "running");
}

export async function getRecentJobs(limit = 10): Promise<Job[]> {
  if (memoryEnabled) {
    const { data, error } = await getSupabase()
      .from("jobs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) {
      logger.warn("jobs:get-recent-supabase-error", { error: error.message });
      return [];
    }
    return (data ?? []).map((r) => rowToJob(r as Record<string, unknown>));
  }
  const jobs = await loadJobsFile();
  return jobs.slice(-limit).reverse();
}
