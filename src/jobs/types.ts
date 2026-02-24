export type JobStatus = "running" | "completed" | "failed" | "killed";
export type ModelId = "claude" | "kimi" | "gemini" | "codex";

export type StepError = {
  jobId: string;
  step: number;
  stepName: string;
  error: string;
  timestamp: string;
  outputSnippet?: string;
};

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
  outcome?: string;
  outcomeSummary?: string;
  stepErrors?: StepError[];
  lastStep?: number;
  lastStepName?: string;
  worktreePath?: string;
  artifactCheck?: Record<string, unknown>;
  parallelGroupId?: string;
  parallelRole?: "primary" | "specialist";
};
