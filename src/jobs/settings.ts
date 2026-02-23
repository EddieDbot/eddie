import { resolve } from "node:path";

const HOME = process.env.HOME ?? "/home/na";
const SETTINGS_DIR = `${HOME}/.claude/settings`;

export type JobType = "heal" | "code" | "research" | "general";

export function detectJobType(prompt: string, tmuxPrefix?: string): JobType {
  if (tmuxPrefix?.startsWith("heal-")) return "heal";
  const lower = prompt.toLowerCase();
  if (
    lower.includes("src/") ||
    lower.includes("self-heal") ||
    lower.includes("fix ") ||
    lower.includes("implement ") ||
    lower.includes("create ") ||
    lower.includes("modify ") ||
    lower.includes("typescript") ||
    lower.includes(".ts")
  ) return "code";
  if (
    lower.includes("research") ||
    lower.includes("analyze") ||
    lower.includes("playlist") ||
    lower.includes("report") ||
    lower.includes("transcript")
  ) return "research";
  return "general";
}

export function resolveJobSettings(opts?: {
  agent?: string;
  jobType?: JobType;
}): string | undefined {
  const jobType = opts?.jobType ?? "general";
  const settingsMap: Record<JobType, string> = {
    heal: resolve(SETTINGS_DIR, "heal-job.json"),
    code: resolve(SETTINGS_DIR, "code-job.json"),
    research: resolve(SETTINGS_DIR, "job-default.json"),
    general: resolve(SETTINGS_DIR, "job-default.json"),
  };
  return settingsMap[jobType];
}
