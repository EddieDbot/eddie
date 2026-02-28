import { readdir, stat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { config } from "../config.ts";
import { isSessionAlive } from "../jobs/tmux.ts";
import { emitEvent } from "./server.ts";

type AgentSession = {
  uuid: string;
  sessionId: string;
  slug: string;
  model: string;
  startedAt: string;
  lastActivity: string;
  status: "working" | "idle" | "completed";
  currentTool: { name: string; timestamp: string } | null;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
  subAgents: {
    agentId: string;
    model: string;
    lastActivity: string;
    status: string;
  }[];
  turnCount: number;
  isWorktree: boolean;
  tmuxAlive: boolean;
  lastTurnDurationMs: number | null;
};

const EDDIE_CWD = process.cwd().replace(/\//g, "-");
const PROJECT_DIR = `${homedir()}/.claude/projects/${EDDIE_CWD}`;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const IDLE_THRESHOLD_MS = 30_000;

const sessions = new Map<string, AgentSession>();

function parseLine(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readTailBytes(
  filePath: string,
  maxBytes = 50 * 1024,
): Promise<string> {
  const fileStat = await stat(filePath);
  const size = fileStat.size;
  if (size === 0) return "";

  const readSize = Math.min(size, maxBytes);
  const offset = size - readSize;

  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(readSize);
    await fh.read(buf, 0, readSize, offset);
    return buf.toString("utf8");
  } finally {
    await fh.close();
  }
}

async function extractSessionName(filePath: string): Promise<string> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(6 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const lines = buf
      .slice(0, bytesRead)
      .toString("utf8")
      .split("\n")
      .filter(Boolean);
    for (const line of lines) {
      const obj = parseLine(line);
      if (!obj || obj.type !== "user") continue;
      const msg = obj.message as Record<string, unknown> | undefined;
      if (!msg) continue;
      const content = msg.content;
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        for (const block of content as Record<string, unknown>[]) {
          if (block?.type === "text" && typeof block.text === "string") {
            text = block.text;
            break;
          }
        }
      }
      const clean = text.trim().replace(/\s+/g, " ").slice(0, 48);
      if (clean.length > 8) return clean;
    }
  } catch {
    // ignore
  } finally {
    await fh.close();
  }
  return "";
}

async function getTmuxAlive(uuid: string): Promise<boolean> {
  const prefix = uuid.slice(0, 8);
  const primary = `claude-${prefix}`;
  if (await isSessionAlive(primary)) return true;

  try {
    const proc = Bun.spawnSync(
      ["tmux", "list-sessions", "-F", "#{session_name}"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const out = new TextDecoder().decode(proc.stdout);
    return out.split("\n").some((s) => s.includes(prefix));
  } catch {
    return false;
  }
}

async function parseFile(filePath: string): Promise<AgentSession | null> {
  const fileStat = await stat(filePath);
  const mtime = fileStat.mtimeMs;
  const startedAt = new Date(
    fileStat.birthtimeMs || fileStat.ctimeMs,
  ).toISOString();
  const lastActivity = new Date(mtime).toISOString();

  const text = await readTailBytes(filePath);
  const lines = text.split("\n").filter(Boolean);

  let uuid: string | null = null;
  let model = "unknown";
  let currentTool: AgentSession["currentTool"] = null;
  let turnCount = 0;
  const tokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  let lastTurnDurationMs: number | null = null;
  let lastUserTs: number | null = null;
  let lastAssistantTs: number | null = null;

  for (const line of lines) {
    const obj = parseLine(line);
    if (!obj) continue;

    if (!uuid && typeof obj.sessionId === "string") {
      uuid = obj.sessionId;
    }

    if (obj.type === "user") {
      turnCount++;
      if (typeof obj.timestamp === "string") {
        lastUserTs = new Date(obj.timestamp).getTime();
      }
    }

    if (obj.type === "assistant") {
      if (typeof obj.timestamp === "string") {
        lastAssistantTs = new Date(obj.timestamp).getTime();
      }
      const msg = obj.message as Record<string, unknown> | undefined;
      if (msg) {
        if (typeof msg.model === "string" && msg.model) {
          model = msg.model;
        }
        const content = msg.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              block &&
              typeof block === "object" &&
              (block as Record<string, unknown>).type === "tool_use" &&
              typeof (block as Record<string, unknown>).name === "string"
            ) {
              currentTool = {
                name: (block as Record<string, unknown>).name as string,
                timestamp: lastActivity,
              };
            }
          }
        }
        const usage = msg.usage as Record<string, unknown> | undefined;
        if (usage) {
          tokenUsage.inputTokens += (usage.input_tokens as number) || 0;
          tokenUsage.outputTokens += (usage.output_tokens as number) || 0;
          tokenUsage.cacheReadTokens +=
            (usage.cache_read_input_tokens as number) || 0;
          tokenUsage.cacheCreationTokens +=
            (usage.cache_creation_input_tokens as number) || 0;
        }
      }
    }
  }

  if (!uuid) return null;

  if (
    lastUserTs !== null &&
    lastAssistantTs !== null &&
    lastAssistantTs > lastUserTs
  ) {
    lastTurnDurationMs = lastAssistantTs - lastUserTs;
  }

  const tmuxAlive = await getTmuxAlive(uuid);
  const now = Date.now();
  const age = now - mtime;

  let status: AgentSession["status"];
  if (!tmuxAlive) {
    status = "completed";
  } else if (age < IDLE_THRESHOLD_MS) {
    status = "working";
  } else {
    status = "idle";
  }

  const name = await extractSessionName(filePath);
  const slug =
    name ||
    `${model.includes("haiku") ? "haiku" : model.includes("opus") ? "opus" : "sonnet"}-${uuid.slice(-6)}`;

  return {
    uuid,
    sessionId: uuid,
    slug,
    model,
    startedAt,
    lastActivity,
    status,
    currentTool,
    tokenUsage,
    subAgents: [],
    turnCount,
    isWorktree: false,
    tmuxAlive,
    lastTurnDurationMs,
  };
}

async function scan(): Promise<void> {
  let files: string[];
  try {
    files = await readdir(PROJECT_DIR);
  } catch {
    return;
  }

  const now = Date.now();
  const cutoff = now - TWO_HOURS_MS;

  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

  for (const file of jsonlFiles) {
    const filePath = `${PROJECT_DIR}/${file}`;
    try {
      const s = await stat(filePath);
      if (s.mtimeMs < cutoff) continue;
      const session = await parseFile(filePath);
      if (session) {
        sessions.set(session.uuid, session);
      }
    } catch {
      // skip unreadable files
    }
  }

  // Evict sessions whose files are now older than 2h
  for (const [uuid, session] of sessions) {
    const age = now - new Date(session.lastActivity).getTime();
    if (age > TWO_HOURS_MS && session.status === "completed") {
      sessions.delete(uuid);
    }
  }
}

export function getAgentSessions(): AgentSession[] {
  return Array.from(sessions.values()).sort(
    (a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
  );
}

export function startAgentWatcher(): void {
  scan().catch(() => {});
  setInterval(async () => {
    await scan().catch(() => {});
    emitEvent("agent:update", { count: sessions.size });
  }, config.AGENT_DASHBOARD_POLL_MS);
}
