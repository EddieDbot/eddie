import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

const HOME = homedir();
const STATE_FILE = resolve(HOME, "brain-vault/20 - Areas/EDDIE/pitch/.detector-state.json");
const UPDATE_LOG = resolve(HOME, "brain-vault/20 - Areas/EDDIE/pitch/update-log.md");
const CAPABILITIES_PATH = resolve(HOME, "eddie/src/routing/capabilities.ts");
const AGENTS_DIR = resolve(HOME, ".claude/agents");
const ENV_PATH = resolve(HOME, "eddie/.env");

const EXCLUDE_AGENT_FILES = new Set(["CHANGELOG.md", "README.md", "_template.md", "CLAUDE.md"]);

interface DetectorState {
  capabilityCount: number;
  agentFiles: string[];
  activeFlags: string[];
  lastRun: string;
}

async function getCapabilityCount(): Promise<number> {
  const content = await Bun.file(CAPABILITIES_PATH).text();
  return [...content.matchAll(/id:\s*["'][^"']+["']/g)].length;
}

async function getAgentFiles(): Promise<string[]> {
  const files = await readdir(AGENTS_DIR).catch(() => [] as string[]);
  return files
    .filter((f) => f.endsWith(".md") && !EXCLUDE_AGENT_FILES.has(f))
    .sort();
}

async function getActiveFlags(): Promise<string[]> {
  const content = await Bun.file(ENV_PATH).text().catch(() => "");
  return content
    .split("\n")
    .filter((l) => l.match(/^[A-Z_]+_ENABLED=true/))
    .map((l) => l.split("=")[0]!)
    .sort();
}

async function loadState(): Promise<DetectorState | null> {
  if (!existsSync(STATE_FILE)) return null;
  return JSON.parse(await readFile(STATE_FILE, "utf-8"));
}

async function saveState(state: DetectorState): Promise<void> {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function appendToLog(entries: string[]): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const lines = [
    `\n## ${today} — Auto-Detected Changes\n`,
    ...entries.map((e) => `- ${e}`),
    "",
  ].join("\n");

  const existing = await readFile(UPDATE_LOG, "utf-8").catch(() => "");
  const insertAt = existing.indexOf("\n## 20"); // insert before first dated section
  const updated =
    insertAt === -1
      ? existing + lines
      : existing.slice(0, insertAt) + lines + existing.slice(insertAt);

  await writeFile(UPDATE_LOG, updated);
  console.log(`[pitch-detector] Appended ${entries.length} change(s) to update-log.md`);
}

export async function runPitchUpdateDetector(): Promise<void> {
  const [capCount, agentFiles, activeFlags] = await Promise.all([
    getCapabilityCount(),
    getAgentFiles(),
    getActiveFlags(),
  ]);

  const prev = await loadState();
  const changes: string[] = [];

  if (!prev) {
    console.log("[pitch-detector] No previous state — establishing baseline");
    await saveState({ capabilityCount: capCount, agentFiles, activeFlags, lastRun: new Date().toISOString() });
    return;
  }

  // Capability count change
  if (capCount !== prev.capabilityCount) {
    const delta = capCount - prev.capabilityCount;
    changes.push(
      `Capabilities: ${prev.capabilityCount} → ${capCount} (${delta > 0 ? "+" : ""}${delta}) — update agent/script sections of pitch`
    );
  }

  // New agents
  const newAgents = agentFiles.filter((f) => !prev.agentFiles.includes(f));
  const removedAgents = prev.agentFiles.filter((f) => !agentFiles.includes(f));
  if (newAgents.length) changes.push(`New agents: ${newAgents.join(", ")} — add to agent roster in pitch`);
  if (removedAgents.length) changes.push(`Removed agents: ${removedAgents.join(", ")} — remove from pitch`);

  // New feature flags
  const newFlags = activeFlags.filter((f) => !prev.activeFlags.includes(f));
  const flagUpdates: Record<string, string> = {
    KANBAN_ENABLED: "KANBAN live — add task management section to pitch",
    SELF_IMPROVE_ENABLED: "Self-improve live — upgrade self-improvement blurb with live capability",
    JOB_QA_GATE_ENABLED: "QA gate live — add quality assurance section to pitch",
    YOUTUBE_ANALYTICS_ENABLED: "YouTube analytics live — add metrics to content pipeline section",
  };
  for (const flag of newFlags) {
    changes.push(`Flag enabled: ${flag} — ${flagUpdates[flag] ?? "review pitch for relevance"}`);
  }

  if (changes.length > 0) {
    await appendToLog(changes);
  } else {
    console.log("[pitch-detector] No pitch-relevant changes detected");
  }

  await saveState({ capabilityCount: capCount, agentFiles, activeFlags, lastRun: new Date().toISOString() });
}

// Run standalone
if (import.meta.main) {
  await runPitchUpdateDetector();
}
