/**
 * Task briefing constructor — applies agent-forge methodology to background job prompts.
 *
 * Principles applied (from ~/brain-vault/10 - Projects/agent-forge/methodology/principles.md):
 * - Identity Over Capability: tell the agent WHO it is, not what it can do
 * - Opinionated Beats Comprehensive: give it a stance, not a menu
 * - Process Creates Consistency: define the steps, not just the goal
 * - Anti-Patterns Are Guardrails: name what NOT to do
 * - Testable Quality: "done when X" must be verifiable
 */

import { homedir } from "node:os";
import { resolve } from "node:path";

const HOME = homedir();
const AGENT_FORGE_PRINCIPLES = resolve(
  HOME,
  "brain-vault/10 - Projects/agent-forge/methodology/principles.md",
);

async function loadAgentForgePrinciples(): Promise<string> {
  try {
    return await Bun.file(AGENT_FORGE_PRINCIPLES).text();
  } catch {
    return "";
  }
}

export type TaskBriefing = {
  // What specific agent(s) to use (slugs from ~/.claude/agents/)
  agents?: string[];
  // The project being worked on
  project?: string;
  // Project path on disk
  projectPath?: string;
  // Raw task description — what needs to happen
  task: string;
  // Clear, verifiable completion criteria
  doneWhen: string;
  // Where to write results
  outputPath?: string;
  // What to explicitly avoid
  avoid?: string[];
  // Raw project context already loaded (injected by buildJobSystemPrompt)
  projectContext?: string;
};

function buildDefaultOutputSection(slug: string | undefined): string {
  const stateFile = slug
    ? `~/brain-vault/90 - Agent Memory/State/${slug}.md`
    : "the matching project state file in ~/brain-vault/90 - Agent Memory/State/";
  const projectLog = slug
    ? `~/brain-vault/10 - Projects/${slug}/EDDIE_LOG.md`
    : "~/brain-vault/10 - Projects/{project-slug}/EDDIE_LOG.md";

  return `## Where to Write Results

Write to **two locations** when done:

**1. Eddie's state file** (\`${stateFile}\`):
- Prepend a new entry to \`## Activity Log\` (create section if missing):
  \`- YYYY-MM-DD HH:MM | AGENTIC | {concise one-line summary}\`
- Update \`## Current Status\` to reflect what changed

**2. Project activity log** (\`${projectLog}\`):
- Prepend the same AGENTIC entry under \`## Log\` (create file if missing)
- File header if creating: \`# EDDIE Activity Log — ${slug ?? "{project}"}\`
- This is what Nicholas sees when working directly in the project — keep it clear`;
}

/**
 * Wraps a raw task into a structured briefing following agent-forge methodology.
 * This is what gets sent as the primary prompt to the background Claude Code session.
 */
export async function buildBriefing(briefing: TaskBriefing): Promise<string> {
  const agentList = briefing.agents?.length
    ? briefing.agents.map((a) => `~/.claude/agents/${a}.md`).join(", ")
    : "the most appropriate agent from ~/.claude/agents/";

  const avoidSection = briefing.avoid?.length
    ? [
        "",
        "## Anti-Patterns to Avoid",
        ...briefing.avoid.map((a) => `- ${a}`),
      ].join("\n")
    : "";

  const slug =
    briefing.projectPath?.split("/").pop() ??
    briefing.project?.toLowerCase().replace(/\s+/g, "-");

  const outputSection = briefing.outputPath
    ? `\n## Where to Write Results\n${briefing.outputPath}`
    : buildDefaultOutputSection(slug);

  return [
    "# Task Briefing",
    "",
    "## Identity",
    `You are an autonomous agent running as a background job on Nicholas's homelab. You operate like a senior engineer who was hired to complete this specific task — you make decisions, you don't ask for approval, you write results back, and you leave the project in a better state than you found it.`,
    "",
    "## Situation",
    briefing.project
      ? `Project: **${briefing.project}**${briefing.projectPath ? ` at \`${briefing.projectPath}\`` : ""}`
      : "Project context is in the system prompt.",
    "The full project state is in the system prompt — read it before doing anything. That is the authoritative source of truth.",
    "",
    "## Task",
    briefing.task,
    "",
    "## Process",
    "1. Read the project state file to understand exactly where things stand — never assume prior knowledge.",
    "2. Identify which agent(s) are best suited and USE THEM: " + agentList,
    "3. Execute the task. If you hit a blocker that requires Nicholas's input (OAuth, external account access, a strategic decision), stop, document the blocker clearly, and exit.",
    "4. Write a clear summary of what you did, what changed, and what's next.",
    "5. Update the project state file.",
    "",
    "## Done When",
    briefing.doneWhen,
    avoidSection,
    outputSection,
  ].join("\n");
}

/**
 * Parse a raw HEARTBEAT_TASK prompt string into a structured TaskBriefing.
 * Extracts agent slugs, project name, done-when criteria from the free-form text.
 */
export function parseRawTask(raw: string): TaskBriefing {
  // Extract "use the X agent" patterns
  const agentMatches = [
    ...raw.matchAll(/\b(?:use\s+(?:the\s+)?)?[`"]?([\w-]+)[`"]?\s+agent/gi),
  ];
  const agents = agentMatches
    .map((m) => m[1]!.toLowerCase())
    .filter((a) => a.length > 2 && a !== "the" && a !== "an" && a !== "a");

  // Extract "done when" criteria
  const doneMatch = /done\s+when[:\s]+(.+?)(?:\.|$)/i.exec(raw);
  const doneWhen =
    doneMatch?.[1]?.trim() ??
    "The task is complete and results are written to Brain Vault.";

  // Extract project path hints
  const pathMatch = /(?:in|at|project[:\s]+)\s*(~\/[\w\s/-]+)/i.exec(raw);
  const projectPath = pathMatch?.[1]?.trim();

  // Extract project name from path or first noun phrase
  const projectNameMatch = pathMatch?.[1]?.split("/").pop()?.replace(/-/g, " ");

  return {
    agents: [...new Set(agents)],
    project: projectNameMatch,
    projectPath,
    task: raw,
    doneWhen,
  };
}
