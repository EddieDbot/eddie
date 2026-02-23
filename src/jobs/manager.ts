import { config } from "../config.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";
import type { Job, ModelId } from "./types.ts";

// Fallback flat-file path used only when Supabase is unavailable
const JOBS_FILE = resolve(config.JOBS_DATA_DIR, "jobs.json");

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
  };
}

// Map Job camelCase → Supabase snake_case insert/update object
function jobToRow(job: Partial<Job> & { id?: string }): Record<string, unknown> {
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
  if (job.outcomeSummary !== undefined) row.outcome_summary = job.outcomeSummary;
  return row;
}

// Flat-file fallback (used when Supabase not configured)
async function loadJobsFile(): Promise<Job[]> {
  try {
    const file = Bun.file(JOBS_FILE);
    if (!(await file.exists())) return [];
    return await file.json();
  } catch {
    return [];
  }
}

async function saveJobsFile(jobs: Job[]): Promise<void> {
  await Bun.write(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

export async function createJob(model: ModelId, prompt: string): Promise<Job> {
  const id = crypto.randomUUID().slice(0, 8);
  const job: Job = {
    id,
    model,
    prompt,
    status: "running",
    tmuxSession: `job-${id}`,
    startedAt: new Date().toISOString(),
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

export async function updateJob(id: string, patch: Partial<Job>): Promise<Job | null> {
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
