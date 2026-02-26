import { config } from "../config.ts";
import { resolve } from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { logger } from "../utils/logger.ts";

// Phase 6: Sandbox strace availability check at module load
const STRACE_AVAILABLE = Bun.spawnSync(["which", "strace"]).exitCode === 0;
import { buildMemoryContext } from "../memory/context.ts";
import { getJobEnvUnsetArgs } from "../claude/env.ts";
import { buildBriefing, parseRawTask } from "./briefing.ts";
import {
  detectJobType,
  detectOptimalModel,
  resolveJobSettings,
  JOB_MCP_MAP,
} from "./settings.ts";
import { createWorktree, shouldUseWorktree } from "./worktree.ts";
import { routeCapabilities } from "../routing/router.ts";
import { getMcpHints } from "../routing/mcp-hints.ts";
import { buildDelegationGuidance } from "../routing/model-kb.ts";
import { classifySource, TrustLevel } from "../security/trust.ts";
import type { Job, ModelId, ChannelContext } from "./types.ts";
import { tickTool } from "../memory/tool-ticker.ts";
import { getCondensedVision } from "../proactive/vision.ts";
import {
  BRAIN_VAULT_ROOT,
  STATE_DIR as BV_STATE_DIR,
  getProjectClaude,
} from "../memory/brain-vault-paths.ts";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const HOME = process.env.HOME ?? "/home/na";
export const JOBS_DIR = resolve(PROJECT_ROOT, "data/jobs");

const DEFAULT_TIMEOUT_MS = 7_200_000; // 2 hours

// Identify which project(s) the prompt is about by matching against state file slugs
async function findRelevantProjects(prompt: string): Promise<string[]> {
  try {
    const files = await readdir(BV_STATE_DIR);
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
    return await Bun.file(resolve(BV_STATE_DIR, `${slug}.md`)).text();
  } catch {
    return "";
  }
}

async function readProjectClaude(slug: string): Promise<string> {
  // Check common project locations for a CLAUDE.md
  const candidates = [
    `${process.env.HOME ?? "/home/na"}/${slug}/CLAUDE.md`,
    getProjectClaude(slug),
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

// Platform doc injection: for jobs involving specific platforms (n8n, Attio, Instantly, Clay),
// inject llms-full.txt from the platform's docs if available.
// Pattern: detect platform name in prompt → fetch docs URL → prepend to system prompt
// Example: if prompt contains "n8n", inject n8n's LLM-formatted docs

// Programmatic tool calling pattern:
// Instead of asking Claude to use tools, explicitly name them:
// "Use the Bash tool to run: bun check" (not "check if types are valid")
// "Use the Read tool to read: src/jobs/tmux.ts" (not "look at the job runner")
// This reduces ambiguity and improves reliability by 30-50% on complex tasks
async function buildJobSystemPrompt(
  prompt: string,
  channelContext?: ChannelContext,
): Promise<string> {
  const briefingData = parseRawTask(prompt);
  const structuredBriefing = await buildBriefing(briefingData);

  const channelHint =
    channelContext === "shared"
      ? "\n[CONTEXT: shared-channel] Write for an audience beyond Nicholas — be professional, avoid internal references."
      : channelContext === "automated"
        ? "\n[CONTEXT: automated] This is a cron/background job. Be terse, skip social niceties, focus on output."
        : ""; // private — default behavior

  const [memCtx, relevantProjects, visionCtx] = await Promise.all([
    buildMemoryContext(prompt).catch(() => ""),
    findRelevantProjects(prompt),
    config.VISION_ENABLED
      ? getCondensedVision().catch(() => "")
      : Promise.resolve(""),
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

  const routing = routeCapabilities(prompt, {
    projectSlug: relevantProjects[0],
  });

  const agentSection =
    routing.agents.length > 0
      ? `## Recommended Agents\nUse these agents for this task: ${routing.agents.join(", ")}\n\nAll other agents are available if needed — use agent slug in your task description to invoke them.`
      : `## Available Agents\nUse agent slugs in your work. Key agents: self-healer, code-reviewer, architect, security-reviewer, transcript-ingester, website-builder, automation-engineer, multi-ai-researcher, and all platform agents (clay, dripify, instantly, attio, n8n, cal-com).`;

  // Wave 2D + Phase 3C: Filter MCPs by job type using JOB_MCP_MAP
  const jobTypeName = detectJobType(prompt, "");
  const jobMcpList = JOB_MCP_MAP[jobTypeName] ?? JOB_MCP_MAP["default"]!;
  const jobMcpNames = jobMcpList.map((m) => m.replace(/^mcp:/, ""));
  const filteredMcps = config.MCP_AUDIT_LOG_ENABLED
    ? routing.mcps.filter((mcp) => jobMcpNames.includes(mcp))
    : routing.mcps;

  const mcpLoadBlock =
    jobMcpList.length > 0
      ? `## LOAD_THESE_MCPS\nLoad these MCPs via ToolSearch before use:\n${jobMcpList.map((m) => `- ${m}`).join("\n")}`
      : "";

  const mcpSection =
    filteredMcps.length > 0
      ? `## MCP Tools Available\n${getMcpHints(filteredMcps)}`
      : "";

  const toolSection =
    routing.contextHints && routing.contextHints.length > 0
      ? `## Script Tools Available\nUse these script commands for this task:\n${routing.contextHints.map((h) => `- ${h}`).join("\n")}`
      : "";

  const base = [
    "You are EDDIE, running as a background job on Nicholas's homelab server (debianhomelabX).",
    "Full file system access, full agent access (~/.claude/agents/), take as long as needed.",
    "This job runs unattended — be thorough, make decisions autonomously, write results back.",
    ...(channelHint ? [channelHint] : []),
    "",
    "## Who You're Working For",
    "Nicholas Alexander Crabill — creative technologist, creative director.",
    "Prefers: TypeScript, functional style, direct output, no fluff.",
    "Brain Vault (Obsidian KB) at ~/brain-vault/ — this is the source of truth for all project state.",
    "",
    agentSection,
    "Pattern: Domain Agent (strategy) → Platform Agent (execution) → Copywriter (refinement)",
    "Spawn agents for parallel tracks. Do sequential tasks directly.",
    "",
    ...(mcpSection ? [mcpSection, ""] : []),
    ...(mcpLoadBlock ? [mcpLoadBlock, ""] : []),
    ...(toolSection ? [toolSection, ""] : []),
    "## Brain Vault Paths (PARA structure)",
    `Inbox:     ${BRAIN_VAULT_ROOT}/00 - Inbox/`,
    `Projects:  ${BRAIN_VAULT_ROOT}/10 - Projects/   (active work with deadlines)`,
    `Areas:     ${BRAIN_VAULT_ROOT}/20 - Areas/      (ongoing domains: EDDIE, AI Research, Homelab, creative-technologist)`,
    `Resources: ${BRAIN_VAULT_ROOT}/30 - Resources/  (idea buckets: ai-money, session-nuggets, health-optimization)`,
    `Archive:   ${BRAIN_VAULT_ROOT}/40 - Archive/`,
    `State:     ${BV_STATE_DIR}/`,
    `Decisions: ${BRAIN_VAULT_ROOT}/90 - Agent Memory/Decisions/`,
    `Learnings: ${BRAIN_VAULT_ROOT}/90 - Agent Memory/Learnings/`,
    `Handovers: ${BRAIN_VAULT_ROOT}/90 - Agent Memory/Handovers/`,
    "Route outputs to the correct tier — e.g. agent-forge → Areas/AI Research/agent-forge/, ai-money → Resources/ai-money/",
    "When done: write a summary under '## Last Agent Action' in the project's state file.",
    "",
    "## Output",
    "Write a clear summary of what you did and what's left. Update the project state file.",
    "",
    "## Execution Protocol (PDAC)",
    "Follow Plan → Do → Assess → Correct cycle for each major step:",
    "1. PLAN: Before acting, identify the specific files/commands needed and expected outcome",
    "2. DO: Execute the step. Emit STEP:N:name at start (e.g. STEP:1:fetch-data)",
    "3. ASSESS: After each step, verify the output matches expectation. Emit STEP_ERROR:N:name:message if it doesn't",
    "4. CORRECT: If assessment fails, fix the issue before proceeding to next step",
    "Self-verification checklist before emitting STEP_COMPLETE:",
    "- [ ] All requested files exist and are non-empty",
    "- [ ] TypeScript compiles (for code tasks: bun run tsc --noEmit)",
    "- [ ] Output matches the task description",
    "Emit STEP_COMPLETE only when ALL checklist items pass.",
    "",
    "## Autonomy Patterns",
    "Step N+1 unblocking: when stuck on step N, skip to step N+1 and return to N later — self-unblock by making progress elsewhere.",
    "Human-in-loop: for irreversible actions (delete, send, publish), pause and emit NEEDS_APPROVAL:<action> before proceeding.",
    // Wave 6C: Framework detection hint
    ...(() => {
      if (!config.FRAMEWORK_PROMPTING_ENABLED) return [];
      const frameworkHint = (() => {
        const frameworks: Record<string, string> = {
          n8n: "Use n8n workflow JSON format. Reference ~/.claude/skills/n8n-workflow-patterns.md.",
          react: "Use React functional components with hooks.",
          supabase: "Use Supabase client from src/memory/client.ts.",
          gramio: "Use GramIO bot patterns from existing src/telegram/ files.",
        };
        for (const [name, hint] of Object.entries(frameworks)) {
          if (prompt.toLowerCase().includes(name))
            return `\n## Framework: ${name}\n${hint}`;
        }
        return "";
      })();
      return frameworkHint ? [frameworkHint] : [];
    })(),
    // Wave 6E: Discovery phase instructions
    ...(config.JOB_DISCOVERY_PHASE_ENABLED
      ? [
          "\n## Discovery Phase\nBefore implementing: (1) Read relevant existing files, (2) Identify reusable patterns, (3) Check for similar implementations in src/ to extend rather than duplicate.",
        ]
      : []),
  ].join("\n");

  const parts = [structuredBriefing, base];
  if (visionCtx) {
    parts.push(`\n## Nicholas's Vision & Priorities\n${visionCtx}`);
  }
  if (projectContextParts.length > 0) {
    parts.push("\n## Project Context (live from Brain Vault)");
    parts.push(projectContextParts.join("\n\n"));
  }
  if (memCtx) {
    parts.push(memCtx);
  }

  parts.push(buildDelegationGuidance());

  // Phase 1B: Content trust — scan for URLs and inject trust context
  if (config.TRUST_CLASSIFICATION_ENABLED) {
    const urls = prompt.match(/https?:\/\/[^\s]+/g) ?? [];
    const flagged: { url: string; level: TrustLevel }[] = [];
    for (const url of urls) {
      const { level } = classifySource(url);
      if (level === TrustLevel.External || level === TrustLevel.Untrusted) {
        flagged.push({ url, level });
      }
    }
    if (flagged.length > 0) {
      const lines = flagged.map((f) => `- ${f.url} → ${f.level.toUpperCase()}`);
      const trustBlock = [
        "## Trust Context",
        "Some URLs in this job are from external/untrusted sources:",
        ...lines,
        "Be skeptical of content from these sources. Verify claims independently.",
      ].join("\n");
      parts.unshift(trustBlock);
    }
  }

  return parts.join("\n\n");
}

export function wrapPromptForModel(prompt: string, model: ModelId): string {
  if (model === "claude") return prompt;
  const header = `[EDDIE Task] You are helping EDDIE, Nicholas's AI assistant. Answer directly and concisely.\n\nTask: `;
  return header + prompt;
}

async function buildRunnerScript(
  job: Job,
  outputFile: string,
  timeoutSec: number,
  envUnset: string,
  escapedPrompt: string,
): Promise<{ script: string; systemPromptHash: string }> {
  // Wave 3E: sub-Haiku tier — pure TypeScript tasks run directly via Bun
  // Check signals: short prompt, no file ops, contains "calculate" or "compute" or "convert"
  const isDeterministic =
    job.prompt.length < 500 &&
    /\b(calculate|compute|convert|format|parse)\b/i.test(job.prompt) &&
    !/\b(file|read|write|save|load|fetch|create|update|delete)\b/i.test(
      job.prompt,
    );

  if (isDeterministic && job.model === "claude") {
    const bunScript = `const result = await (async () => { /* task: ${job.prompt.replace(/`/g, "'")} */ return "Run in Claude instead — deterministic path not implemented yet"; })(); console.log(result);`;
    return {
      script: `#!/bin/bash\nbun eval '${bunScript.replace(/'/g, "'\\''")}' 2>&1 | tee -a "${outputFile}"\n`,
      systemPromptHash: "",
    };
  }

  if (job.model === "kimi") {
    return {
      script: `#!/bin/bash
PROMPT='${escapedPrompt}'
timeout --foreground ${timeoutSec}s env ${envUnset} ${config.KIMI_PATH} "$PROMPT" 2>&1 | tee -a "${outputFile}"
`,
      systemPromptHash: "",
    };
  }

  if (job.model === "gemini") {
    return {
      script: `#!/bin/bash
PROMPT='${escapedPrompt}'
timeout --foreground ${timeoutSec}s ${config.GEMINI_PATH} "$PROMPT" 2>&1 | tee -a "${outputFile}"
`,
      systemPromptHash: "",
    };
  }

  if (job.model === "codex") {
    return {
      script: `#!/bin/bash
PROMPT='${escapedPrompt}'
timeout --foreground ${timeoutSec}s env ${envUnset} ${config.CODEX_PATH} --approval-mode full-auto --skip-git-repo-check "$PROMPT" 2>&1 | tee -a "${outputFile}"
`,
      systemPromptHash: "",
    };
  }

  // Default: claude with system prompt
  const systemPrompt = await buildJobSystemPrompt(
    job.prompt,
    job.channelContext,
  );
  const systemFile = resolve(JOBS_DIR, `job-${job.id}-system.txt`);
  await Bun.write(systemFile, systemPrompt);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(systemPrompt);
  const systemPromptHash = hasher.digest("hex");
  const escapedSystem = systemPrompt
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\''");
  const jobType = detectJobType(job.prompt, job.tmuxSession);
  const settingsPath = resolveJobSettings({ jobType });
  const settingsArg = settingsPath ? `--settings "${settingsPath}"` : "";
  const imageArgs = (job.attachments ?? [])
    .map((p) => `--image "${p}"`)
    .join(" ");

  // Phase 6: Sandbox audit prefix — strace network tracing for sandboxed jobs
  let sandboxPrefix = "";
  if (job.sandboxed) {
    if (STRACE_AVAILABLE) {
      const sandboxLog = resolve(
        config.JOBS_DATA_DIR,
        `sandbox-${job.id}-network.log`,
      );
      sandboxPrefix = `strace -f -e trace=network -o "${sandboxLog}" `;
    } else {
      logger.warn("sandbox:strace-unavailable", { jobId: job.id });
    }
  }

  // Route claude subprocess to EDDIE's credential home when configured
  const homeOverride = config.EDDIE_CLAUDE_HOME
    ? `HOME=${config.EDDIE_CLAUDE_HOME} `
    : "";

  return {
    script: `#!/bin/bash
PROMPT='${escapedPrompt}'
SYSTEM='${escapedSystem}'
timeout --foreground ${timeoutSec}s env ${envUnset} ${homeOverride}${sandboxPrefix}${config.CLAUDE_PATH} -p "$PROMPT" --output-format text --model claude-sonnet-4-6 --dangerously-skip-permissions ${settingsArg}${imageArgs ? ` ${imageArgs}` : ""} --append-system-prompt "$SYSTEM" 2>&1 | tee -a "${outputFile}"
`,
    systemPromptHash,
  };
}

const PERSISTENT_SESSION_NAME = "eddie-jobs";
const WINDOW_NAME_MAX = 20;

function toWindowName(sessionName: string): string {
  const stripped = sessionName.replace(/^job-/, "");
  return stripped.length > WINDOW_NAME_MAX
    ? stripped.slice(-WINDOW_NAME_MAX)
    : stripped;
}

function getTargetRef(sessionName: string): string {
  if (!config.PERSISTENT_JOBS_SESSION) return sessionName;
  return `${PERSISTENT_SESSION_NAME}:${toWindowName(sessionName)}`;
}

async function ensurePersistentSession(): Promise<void> {
  const check = Bun.spawn(
    [config.TMUX_PATH, "has-session", "-t", PERSISTENT_SESSION_NAME],
    { stderr: "ignore", stdout: "ignore" },
  );
  const code = await check.exited;
  if (code !== 0) {
    const create = Bun.spawn([
      config.TMUX_PATH,
      "new-session",
      "-d",
      "-s",
      PERSISTENT_SESSION_NAME,
    ]);
    await create.exited;
  }
}

export async function spawnJob(job: Job): Promise<void> {
  await mkdir(JOBS_DIR, { recursive: true }).catch(() => {});
  // Validate model binary exists before spawning
  const effectiveModel = detectOptimalModel(job.prompt, job.model);
  const modelPath =
    effectiveModel === "kimi"
      ? config.KIMI_PATH
      : effectiveModel === "gemini"
        ? config.GEMINI_PATH
        : effectiveModel === "codex"
          ? config.CODEX_PATH
          : config.CLAUDE_PATH;

  const checkProc = Bun.spawnSync(["which", modelPath]);
  if (checkProc.exitCode !== 0) {
    const errMsg = `Model binary not found: ${modelPath} (model=${effectiveModel})`;
    logger.error("jobs:model-not-found", {
      id: job.id,
      modelPath,
      effectiveModel,
    });
    const { updateJob: updateJobFn } = await import("./manager.ts");
    await updateJobFn(job.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: errMsg,
      outcome: "failed",
      outcomeSummary: errMsg,
    }).catch(() => {});
    return;
  }

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

  const { script: runnerScript, systemPromptHash } = await buildRunnerScript(
    job,
    outputFile,
    timeoutSec,
    envUnset,
    escapedPrompt,
  );

  await Bun.write(runnerFile, runnerScript);

  if (config.PERSISTENT_JOBS_SESSION) {
    await ensurePersistentSession();
    const windowName = toWindowName(job.tmuxSession);
    const proc = Bun.spawn([
      config.TMUX_PATH,
      "new-window",
      "-t",
      `${PERSISTENT_SESSION_NAME}:`,
      "-n",
      windowName,
      "-c",
      jobWorkdir,
      `bash "${runnerFile}"`,
    ]);
    await proc.exited;
  } else {
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
  }
  tickTool({
    tool_type: "model",
    tool_name: job.model,
    job_id: job.id,
    context: "spawn",
  }).catch(() => {});

  const { updateJob } = await import("./manager.ts");
  if (systemPromptHash) {
    updateJob(job.id, { systemPromptHash }).catch(() => {});
  }
  if (worktreeResult) {
    updateJob(job.id, { worktreePath: worktreeResult.path }).catch(() => {});
  }
}

export async function isSessionAlive(sessionName: string): Promise<boolean> {
  const target = getTargetRef(sessionName);
  const proc = Bun.spawn([config.TMUX_PATH, "has-session", "-t", target], {
    stderr: "ignore",
    stdout: "ignore",
  });
  const code = await proc.exited;
  return code === 0;
}

export async function killSession(sessionName: string): Promise<boolean> {
  const target = getTargetRef(sessionName);
  const [cmd, arg] = config.PERSISTENT_JOBS_SESSION
    ? ["kill-window", "-t"]
    : ["kill-session", "-t"];
  const proc = Bun.spawn([config.TMUX_PATH, cmd, arg, target], {
    stderr: "ignore",
    stdout: "ignore",
  });
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
  const target = getTargetRef(sessionName);
  const paneProc = Bun.spawn(
    [config.TMUX_PATH, "list-panes", "-t", target, "-F", "#{pane_pid}"],
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
  const target = getTargetRef(sessionName);
  const proc = Bun.spawn(
    [config.TMUX_PATH, "capture-pane", "-p", "-t", target, "-S", `-${lines}`],
    { stdout: "pipe", stderr: "ignore" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}
