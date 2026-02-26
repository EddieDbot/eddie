import { resolve } from "node:path";
import type { ModelId } from "./types.ts";

const HOME = process.env.HOME ?? "/home/na";
const SETTINGS_DIR = `${HOME}/.claude/settings`;

export type JobType = "heal" | "code" | "research" | "general";

export function detectOptimalModel(
  prompt: string,
  defaultModel: ModelId,
): ModelId {
  if (defaultModel !== "claude") return defaultModel;
  const lower = prompt.toLowerCase();
  if (
    /\b(translat|chinese|mandarin|japanese|korean|french|spanish|german)\b/.test(
      lower,
    )
  )
    return "kimi";
  if (/\b(image|vision|screenshot|multimodal|video frame)\b/.test(lower))
    return "gemini";
  if (
    /\b(math|calcul|equation|proof|aime|olympiad|abstract reasoning)\b/.test(
      lower,
    )
  )
    return "codex";
  return defaultModel;
}

export function detectJobType(prompt: string, tmuxPrefix?: string): JobType {
  if (tmuxPrefix?.startsWith("heal-")) return "heal";
  const lower = prompt.toLowerCase();
  // Research check runs first — playlist/transcript/report jobs must not be
  // misclassified as "code" due to generic words like "create" appearing in prompts.
  if (
    lower.includes("playlist") ||
    lower.includes("transcript") ||
    lower.includes("research") ||
    lower.includes("analyze") ||
    lower.includes("report")
  )
    return "research";
  if (
    lower.includes("src/") ||
    lower.includes("self-heal") ||
    lower.includes("fix ") ||
    lower.includes("implement ") ||
    lower.includes("create ") ||
    lower.includes("modify ") ||
    lower.includes("typescript") ||
    lower.includes(".ts")
  )
    return "code";
  return "general";
}

export const JOB_MCP_MAP: Record<string, string[]> = {
  "transcript-ingestion": ["mcp:youtube-transcript"],
  research: ["mcp:brave-search", "mcp:context7"],
  "content-brief": ["mcp:brave-search"],
  "memory-sync": ["mcp:vector-memory"],
  "self-heal": [],
  "web-scrape": ["mcp:playwright"],
  default: ["mcp:brave-search", "mcp:vector-memory"],
};

export function resolveJobSettings(opts?: {
  agent?: string;
  jobType?: JobType;
}): string | undefined {
  const jobType = opts?.jobType ?? "general";
  const settingsMap: Record<JobType, string> = {
    heal: resolve(SETTINGS_DIR, "heal-job.json"),
    code: resolve(SETTINGS_DIR, "code-job.json"),
    research: resolve(SETTINGS_DIR, "research-job.json"),
    general: resolve(SETTINGS_DIR, "job-default.json"),
  };
  return settingsMap[jobType];
}
