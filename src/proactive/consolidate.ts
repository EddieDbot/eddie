import { config } from "../config.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { storeFact } from "../memory/store.ts";
import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";

const HOME = process.env.HOME ?? "/home/na";
const STATE_FILE = `${HOME}/brain-vault/90 - Agent Memory/State/eddie-current.md`;
const DAILY_LOG_DIR = `${HOME}/brain-vault/90 - Agent Memory/Learnings`;

async function getRecentConversations(windowMs: number): Promise<string> {
  if (!memoryEnabled) return "";
  const since = new Date(Date.now() - windowMs).toISOString();
  try {
    const { data, error } = await getSupabase()
      .from("conversations")
      .select("role, content, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error || !data || data.length === 0) return "";
    return data
      .map((c) => `[${c.role}] ${c.content.slice(0, 500)}`)
      .join("\n---\n");
  } catch {
    return "";
  }
}

async function getTerminalLogs(windowMs: number): Promise<string> {
  const terminalLog = resolve(config.JOBS_DATA_DIR, "terminal-log.txt");
  try {
    const file = Bun.file(terminalLog);
    if (!(await file.exists())) return "";
    const text = await file.text();
    const since = Date.now() - windowMs;
    const lines = text
      .trim()
      .split("\n")
      .filter((line) => {
        const match = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
        if (!match) return false;
        return new Date(match[1]!).getTime() >= since;
      });
    return lines.join("\n");
  } catch {
    return "";
  }
}

async function summarizeWithHaiku(
  conversations: string,
  terminal: string,
): Promise<string | null> {
  if (!config.ANTHROPIC_API_KEY) return null;

  const parts: string[] = [];
  if (conversations)
    parts.push("## Telegram/Relay Conversations\n" + conversations);
  if (terminal) parts.push("## Terminal Activity\n" + terminal);
  if (parts.length === 0) return null;

  const userContent = [
    "Summarize recent EDDIE activity. Extract: 1) what was decided or built, 2) current state/status, 3) what's in progress or next.",
    "Be concise — 3-6 bullet points. No fluff.",
    "",
    parts.join("\n\n"),
  ].join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as {
      content: { type: string; text: string }[];
    };
    return data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  } catch {
    return null;
  }
}

async function writeStateFile(
  summary: string,
  terminal: string,
): Promise<void> {
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    timeZone: config.TIMEZONE,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const sections = [
    "# EDDIE Session State",
    `*Last updated: ${timeStr}*`,
    "",
    "## Recent Summary",
    summary,
  ];

  if (terminal) {
    sections.push("", "## Terminal Activity", terminal);
  }

  await Bun.write(STATE_FILE, sections.join("\n"));

  // Append to daily cumulative log
  const dateStr = now.toISOString().slice(0, 10);
  const dailyLog = `${DAILY_LOG_DIR}/${dateStr}-eddie-activity.md`;
  const entry = `\n\n## ${timeStr}\n\n${summary}`;

  try {
    const existing = await Bun.file(dailyLog)
      .text()
      .catch(() => `# EDDIE Activity — ${dateStr}`);
    await Bun.write(dailyLog, existing + entry);
  } catch (err) {
    logger.warn("consolidate:daily-log-error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function runConsolidation(): Promise<void> {
  // Window = interval + 30min overlap to avoid gaps
  const windowMs = config.CONSOLIDATE_INTERVAL_MS + 30 * 60 * 1000;

  const [conversations, terminal] = await Promise.all([
    getRecentConversations(windowMs),
    getTerminalLogs(windowMs),
  ]);

  if (!conversations && !terminal) {
    logger.debug("consolidate:skip", { reason: "no activity" });
    return;
  }

  logger.info("consolidate:run");

  const summary = await summarizeWithHaiku(conversations, terminal);
  if (!summary) {
    logger.warn("consolidate:no-summary");
    return;
  }

  await writeStateFile(summary, terminal);

  if (memoryEnabled) {
    storeFact(`[hourly-state] ${summary}`, "learning", "consolidation").catch(
      () => {},
    );
  }

  // Push codebase snapshot to GitHub
  await gitPush();

  logger.info("consolidate:done");
}

async function gitPush(): Promise<void> {
  try {
    const { spawnSync } = await import("bun");
    const status = spawnSync(
      ["git", "-C", "/home/na/eddie", "status", "--porcelain"],
      {
        stdout: "pipe",
      },
    );
    const dirty = status.stdout?.toString().trim();
    if (!dirty) {
      logger.debug("consolidate:git-push-skip", {
        reason: "nothing to commit",
      });
      return;
    }
    spawnSync(["git", "-C", "/home/na/eddie", "add", "-A"]);
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    spawnSync([
      "git",
      "-C",
      "/home/na/eddie",
      "commit",
      "-m",
      `chore: auto-snapshot ${now}`,
    ]);
    const push = spawnSync(
      ["git", "-C", "/home/na/eddie", "push", "origin", "main"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    if (push.exitCode === 0) {
      logger.info("consolidate:git-pushed");
    } else {
      logger.warn("consolidate:git-push-failed", {
        error: push.stderr?.toString().trim(),
      });
    }
  } catch (err) {
    logger.warn("consolidate:git-push-error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startConsolidation(): void {
  logger.info("consolidate:start", {
    intervalMs: config.CONSOLIDATE_INTERVAL_MS,
  });

  // Run once at startup (after 30s to let bot settle)
  setTimeout(() => {
    runConsolidation().catch((err) =>
      logger.error("consolidate:error", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    setInterval(() => {
      runConsolidation().catch((err) =>
        logger.error("consolidate:error", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }, config.CONSOLIDATE_INTERVAL_MS);
  }, 30_000);
}
