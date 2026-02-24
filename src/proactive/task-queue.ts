import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";

type TaskState = "planned" | "ready" | "running" | "done" | "skipped";

export type QueuedTask = {
  id: string;
  title: string;
  description?: string;
  priority: number;
  state: TaskState;
  source: string;
  goalId?: string;
  projectSlug?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  jobId?: string;
  visionScore?: number;
};

export async function addTask(
  title: string,
  description?: string,
  opts?: {
    priority?: number;
    source?: string;
    goalId?: string;
    projectSlug?: string;
    visionScore?: number;
  },
): Promise<QueuedTask | null> {
  if (!memoryEnabled) return null;
  const row = {
    title,
    description: description ?? null,
    priority: opts?.priority ?? 5,
    state: "planned" as TaskState,
    source: opts?.source ?? "manual",
    goal_id: opts?.goalId ?? null,
    project_slug: opts?.projectSlug ?? null,
    vision_score: opts?.visionScore ?? null,
  };
  const { data, error } = await getSupabase()
    .from("task_queue")
    .insert(row)
    .select()
    .single();
  if (error) {
    logger.warn("task-queue:add-error", { error: error.message });
    return null;
  }
  return rowToTask(data as Record<string, unknown>);
}

export async function getNextTask(): Promise<QueuedTask | null> {
  if (!memoryEnabled) return null;
  const { data, error } = await getSupabase()
    .from("task_queue")
    .select("*")
    .eq("state", "ready")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  if (error || !data) return null;
  return rowToTask(data as Record<string, unknown>);
}

export async function getQueuedTasks(filter?: {
  state?: TaskState;
}): Promise<QueuedTask[]> {
  if (!memoryEnabled) return [];
  let query = getSupabase()
    .from("task_queue")
    .select("*")
    .order("priority", { ascending: true });
  if (filter?.state) query = query.eq("state", filter.state);
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((r) => rowToTask(r as Record<string, unknown>));
}

export async function updateTaskState(
  id: string,
  state: TaskState,
  opts?: { jobId?: string },
): Promise<void> {
  if (!memoryEnabled) return;
  const patch: Record<string, unknown> = { state };
  if (state === "running") patch.started_at = new Date().toISOString();
  if (state === "done" || state === "skipped")
    patch.completed_at = new Date().toISOString();
  if (opts?.jobId) patch.job_id = opts.jobId;
  const { error } = await getSupabase()
    .from("task_queue")
    .update(patch)
    .eq("id", id);
  if (error) logger.warn("task-queue:update-error", { error: error.message });
}

export async function getQueueStats(): Promise<Record<TaskState, number>> {
  if (!memoryEnabled)
    return { planned: 0, ready: 0, running: 0, done: 0, skipped: 0 };
  const { data } = await getSupabase().from("task_queue").select("state");
  const counts: Record<TaskState, number> = {
    planned: 0,
    ready: 0,
    running: 0,
    done: 0,
    skipped: 0,
  };
  for (const row of data ?? []) {
    const s = row.state as TaskState;
    if (s in counts) counts[s]++;
  }
  return counts;
}

function rowToTask(row: Record<string, unknown>): QueuedTask {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? undefined,
    priority: row.priority as number,
    state: row.state as TaskState,
    source: row.source as string,
    goalId: (row.goal_id as string | null) ?? undefined,
    projectSlug: (row.project_slug as string | null) ?? undefined,
    createdAt: row.created_at as string,
    startedAt: (row.started_at as string | null) ?? undefined,
    completedAt: (row.completed_at as string | null) ?? undefined,
    jobId: (row.job_id as string | null) ?? undefined,
    visionScore: (row.vision_score as number | null) ?? undefined,
  };
}
