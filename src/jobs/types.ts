export type JobStatus = "running" | "completed" | "failed" | "killed";
export type ModelId = "claude" | "kimi";

export type Job = {
  id: string;
  model: ModelId;
  prompt: string;
  status: JobStatus;
  tmuxSession: string;
  outputPath?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  timeoutMs?: number;
  outcome?: string; // auto-assessed on completion: "success" | "partial" | "failed"
  outcomeSummary?: string; // one-line haiku assessment of what was accomplished
};
