import { config } from "../config.ts";
import { resolve } from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { logger } from "../utils/logger.ts";
import { buildMemoryContext } from "../memory/context.ts";
import { getJobEnvUnsetArgs } from "../claude/env.ts";
import { buildBriefing, parseRawTask } from "./briefing.ts";
import { detectJobType, resolveJobSettings } from "./settings.ts";
import { createWorktree, shouldUseWorktree } from "./worktree.ts";
import type { Job } from "./types.ts";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const HOME = process.env.HOME ?? "/home/na";
export const JOBS_DIR = resolve(PROJECT_ROOT, "data/jobs");
const BRAIN_VAULT = `${HOME}/brain-vault`;
const STATE_DIR = `${BRAIN_VAULT}/90 - Agent Memory/State`;

const DEFAULT_TIMEOUT_MS = 7_200_000; // 2 hours

// Identify which project(s) the prompt is about by matching against state file slugs
async function findRelevantProjects(prompt: string): Promise<string[]> {
  try {
    const files = await readdir(STATE_DIR);
    const slugs = files
      .filter((f) => f.endsWith(".md") && !f.endsWith(".bak"))
      .map((f) => f.replace(/\.md$/, ""));
    const lower = prompt.toLowerCase();
    return slugs.filter((slug) => {
      const normalized = slug.replace(/-/g, " ");
      return lower.includes(slug) || lower.includes(normalized);
    });
  } catch {
    return [];
  }
}

async function readProjectState(slug: string): Promise<string> {
  try {
    return await Bun.file(resolve(STATE_DIR, `${slug}.md`)).text();
  } catch {
    return "";
  }
}

async function readProjectClaude(slug: string): Promise<string> {
  // Check common project locations for a CLAUDE.md
  const candidates = [
    `${HOME}/${slug}/CLAUDE.md`,
    `${BRAIN_VAULT}/10 - Projects/${slug}/CLAUDE.md`,
    `${HOME}/Documents/Brain Vault/10 - Projects/${slug}/CLAUDE.md`,
  ];
  for (const path of candidates) {
    try {
      const content = await Bun.file(path).text();
      if (content) return content;
    } catch {
      // try next
    }
  }
  return "";
}

async function buildJobSystemPrompt(prompt: string): Promise<string> {
  const briefingData = parseRawTask(prompt);
  const structuredBriefing = await buildBriefing(briefingData);

  const [memCtx, relevantProjects] = await Promise.all([
    buildMemoryContext(prompt).catch(() => ""),
    findRelevantProjects(prompt),
  ]);

  // Load full state + CLAUDE.md for each matched project
  const projectContextParts: string[] = [];
  for (const slug of relevantProjects.slice(0, 3)) {
    const [state, claudeMd] = await Promise.all([
      readProjectState(slug),
      readProjectClaude(slug),
    ]);
    if (state) {
      projectContextParts.push(
        `<project_state project="${slug}">\n${state}\n</project_state>`,
      );
    }
    if (claudeMd) {
      projectContextParts.push(
        `<project_claude_md project="${slug}">\n${claudeMd}\n</project_claude_md>`,
      );
    }
  }

  const base = [
    "You are EDDIE, running as a background job on Nicholas's homelab server (debianhomelabX).",
    "Full file system access, full agent access (~/.claude/agents/), take as long as needed.",
    "This job runs unattended — be thorough, make decisions autonomously, write results back.",
    "",
    "## Who You're Working For",
    "Nicholas Alexander Crabill — creative technologist, creative director.",
    "Prefers: TypeScript, functional style, direct output, no fluff.",
    "Brain Vault (Obsidian KB) at ~/brain-vault/ — this is the source of truth for all project state.",
    "",
    "## Agent Composition",
    "Agents at ~/.claude/agents/ — USE THEM for specialized work.",
    "Domain agents: website-builder, copywriter, cold-outreach-strategist, offer-architect, revenue-architect, automation-engineer, conversion-architect, funnel-diagnostician, sales-strategist",
    "Platform agents: clay, dripify, instantly, n8n, attio, cal-com",
    "Utility agents: security-reviewer, build-validator, refactor-reviewer, project-orchestrator, memory-sync, transcript-ingester, treasure-hunter",
    "Pattern: Domain Agent (strategy) → Platform Agent (execution) → Copywriter (refinement)",
    "Spawn agents for parallel tracks. Do sequential tasks directly.",
    "",
    "## Brain Vault Paths",
    `Projects: ${BRAIN_VAULT}/10 - Projects/`,
    `State files: ${STATE_DIR}/`,
    `Decisions: ${BRAIN_VAULT}/90 - Agent Memory/Decisions/`,
    `Learnings: ${BRAIN_VAULT}/90 - Agent Memory/Learnings/`,
    "When done: write a summary under '## Last Agent Action' in the project's state file.",
    "",
    "## Output",
    "Write a clear summary of what you did and what's left. Update the project state file.",
    "",
    "## Progress Tracking",
    "Emit STEP:N:name markers in output to track progress (e.g. STEP:1:fetch-data). On error: STEP_ERROR:N:name:message. When complete: STEP_COMPLETE.",
  ].join("\n");

  const parts = [structuredBriefing, base];
  if (projectContextParts.length > 0) {
    parts.push("\n## Project Context (live from Brain Vault)");
    parts.push(projectContextParts.join("\n\n"));
  }
  if (memCtx) {
    parts.push(memCtx);
  }

  return parts.join("\n\n");
}

export async function spawnJob(job: Job): Promise<void> {
  await mkdir(JOBS_DIR, { recursive: true }).catch(() => {});

  // Optionally create an isolated worktree for code-modification jobs
  let worktreeResult: { path: string; branch: string } | undefined;
  if (shouldUseWorktree(job.prompt, job.tmuxSession)) {
    try {
      worktreeResult = await createWorktree(job.id);
    } catch (err) {
      logger.warn("jobs:worktree-skip", {
        id: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const jobWorkdir = worktreeResult?.path ?? PROJECT_ROOT;

  const promptFile = resolve(JOBS_DIR, `job-${job.id}-prompt.txt`);
  const outputFile = resolve(JOBS_DIR, `job-${job.id}-output.txt`);
  const systemFile = resolve(JOBS_DIR, `job-${job.id}-system.txt`);
  await Bun.write(promptFile, job.prompt);
  // Pre-write a start marker so zombie detection never falsely kills a job that is
  // just slow to produce output (pipe block-buffering keeps size=0 until flush/exit).
  await Bun.write(
    outputFile,
    `job:started id=${job.id} at=${new Date().toISOString()}\n`,
  );

  const timeoutMs =
    job.timeoutMs ??
    (config as any).JOBS_DEFAULT_TIMEOUT_MS ??
    DEFAULT_TIMEOUT_MS;
  const timeoutSec = Math.floor(timeoutMs / 1000);
  const envUnset = getJobEnvUnsetArgs();

  const runnerFile = resolve(JOBS_DIR, `job-${job.id}-runner.sh`);

  // Embed prompt/system inline so runner never depends on files that may be cleaned up
  const escapedPrompt = job.prompt
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\''");

  let runnerScript: string;
  if (job.model === "kimi") {
    runnerScript = `#!/bin/bash
PROMPT='${escapedPrompt}'
env ${envUnset} ${config.KIMI_PATH} "$PROMPT" 2>&1 | tee -a "${outputFile}"
`;
  } else {
    const systemPrompt = await buildJobSystemPrompt(job.prompt);
    await Bun.write(systemFile, systemPrompt);
    const escapedSystem = systemPrompt
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "'\\''");
    const jobType = detectJobType(job.prompt, job.tmuxSession);
    const settingsPath = resolveJobSettings({ jobType });
    const settingsArg = settingsPath ? `--settings "${settingsPath}"` : "";
    runnerScript = `#!/bin/bash
PROMPT='${escapedPrompt}'
SYSTEM='${escapedSystem}'
timeout --foreground ${timeoutSec}s env ${envUnset} ${config.CLAUDE_PATH} -p "$PROMPT" --output-format text --model claude-sonnet-4-6 --dangerously-skip-permissions ${settingsArg} --append-system-prompt "$SYSTEM" 2>&1 | tee -a "${outputFile}"
`;
  }

  await Bun.write(runnerFile, runnerScript);

  const proc = Bun.spawn([
    config.TMUX_PATH,
    "new-session",
    "-d",
    "-s",
    job.tmuxSession,
    "-c",
    jobWorkdir,
    `bash "${runnerFile}"`,
  ]);
  await proc.exited;

  if (worktreeResult) {
    const { updateJob } = await import("./manager.ts");
    updateJob(job.id, { worktreePath: worktreeResult.path }).catch(() => {});
  }
}

export async function isSessionAlive(sessionName: string): Promise<boolean> {
  const proc = Bun.spawn([config.TMUX_PATH, "has-session", "-t", sessionName], {
    stderr: "ignore",
    stdout: "ignore",
  });
  const code = await proc.exited;
  return code === 0;
}

export async function killSession(sessionName: string): Promise<boolean> {
  const proc = Bun.spawn(
    [config.TMUX_PATH, "kill-session", "-t", sessionName],
    {
      stderr: "ignore",
      stdout: "ignore",
    },
  );
  const code = await proc.exited;
  return code === 0;
}

export async function readOutput(jobId: string): Promise<string> {
  const outputFile = resolve(JOBS_DIR, `job-${jobId}-output.txt`);
  try {
    const file = Bun.file(outputFile);
    if (!(await file.exists())) return "";
    const text = await file.text();
    return text.length > 10_000 ? text.slice(-10_000) : text;
  } catch {
    return "";
  }
}

export async function getOutputSize(jobId: string): Promise<number> {
  const outputFile = resolve(JOBS_DIR, `job-${jobId}-output.txt`);
  try {
    const file = Bun.file(outputFile);
    if (!(await file.exists())) return 0;
    return file.size;
  } catch {
    return 0;
  }
}

/**
 * Zombie detection: walk the process tree rooted at the tmux pane and check
 * whether any descendant is in a stopped state (T* in ps stat).
 *
 * This catches SIGTTOU and other stop signals — e.g. the `timeout` without
 * `--foreground` bug where claude receives SIGTTOU and halts silently.
 * Unlike the old size-based check this works regardless of output format or
 * buffering behaviour, and won't false-positive on slow but healthy jobs.
 *
 * Returns the first stopped process found, or { zombie: false } if none.
 */
export async function detectZombieProcess(sessionName: string): Promise<{
  zombie: boolean;
  pid?: number;
  state?: string;
}> {
  // Zombie threshold: 2-minute grace period before checking (see poll.ts ZOMBIE_THRESHOLD_MS)
  // Detection: any T* (stopped) state in process tree = zombie
  // Common cause: SIGTTOU from missing --foreground on timeout (now fixed)

  // Step 1: get the tmux pane PID
  const paneProc = Bun.spawn(
    [config.TMUX_PATH, "list-panes", "-t", sessionName, "-F", "#{pane_pid}"],
    { stdout: "pipe", stderr: "ignore" },
  );
  const paneOut = await new Response(paneProc.stdout).text();
  const panePid = parseInt(paneOut.trim(), 10);
  if (isNaN(panePid)) return { zombie: false };

  // Step 2: snapshot all processes with pid, ppid, stat in one shot
  const psProc = Bun.spawn(["ps", "-eo", "pid,ppid,stat", "--no-headers"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const psOut = await new Response(psProc.stdout).text();

  const processes = new Map<number, { ppid: number; stat: string }>();
  for (const line of psOut.trim().split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const pid = parseInt(parts[0]!, 10);
    const ppid = parseInt(parts[1]!, 10);
    const stat = parts[2]!;
    if (!isNaN(pid) && !isNaN(ppid)) processes.set(pid, { ppid, stat });
  }

  // Step 3: BFS from panePid, return on first T* (stopped) descendant
  const visited = new Set<number>();
  const queue = [panePid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (visited.has(pid)) continue;
    visited.add(pid);

    const info = processes.get(pid);
    if (!info) continue;

    // T = stopped by signal, Tl = stopped multi-threaded (SIGTTOU victim)
    if (info.stat.startsWith("T"))
      return { zombie: true, pid, state: info.stat };

    for (const [childPid, childInfo] of processes) {
      if (childInfo.ppid === pid && !visited.has(childPid))
        queue.push(childPid);
    }
  }

  return { zombie: false };
}

export async function capturePane(
  sessionName: string,
  lines = 200,
): Promise<string> {
  const proc = Bun.spawn(
    [
      config.TMUX_PATH,
      "capture-pane",
      "-p",
      "-t",
      sessionName,
      "-S",
      `-${lines}`,
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}
