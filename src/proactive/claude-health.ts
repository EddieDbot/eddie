import { resolve } from "node:path";
import { homedir } from "node:os";
import type { Bot } from "gramio";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { checkContextDrift } from "./context-drift.ts";

const HOME = homedir();
const INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

const MCP_CONFIG_FILES = [
  resolve(HOME, ".mcp.json"),
  resolve(HOME, "eddie/.mcp.json"),
];

type IssueType = "version-lock" | "mcp-parse" | "mcp-schema";
type Severity = "warning" | "error";

interface HealthIssue {
  type: IssueType;
  severity: Severity;
  detail: string;
  file?: string;
  autoFixed?: boolean;
}

// ── Checks ────────────────────────────────────────────────────────────────────

async function checkVersionLocks(): Promise<HealthIssue[]> {
  const issues: HealthIssue[] = [];
  try {
    const proc = Bun.spawnSync(["pgrep", "-a", "-f", "share/claude/versions"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const lines = new TextDecoder()
      .decode(proc.stdout)
      .trim()
      .split("\n")
      .filter(Boolean);

    const versions = new Map<string, number[]>();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pidStr = parts[0];
      const rest = parts.slice(1);
      const match = rest.join(" ").match(/versions\/([^/\s]+)/);
      if (!match || !match[1] || !pidStr) continue;
      const version = match[1];
      const pid = parseInt(pidStr);
      if (!versions.has(version)) versions.set(version, []);
      versions.get(version)!.push(pid);
    }

    if (versions.size > 1) {
      // Check each process state — stopped/zombie are stale locks
      for (const [version, pids] of versions) {
        for (const pid of pids) {
          const stat = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)], {
            stdout: "pipe",
          });
          const state = new TextDecoder().decode(stat.stdout).trim();
          if (state.startsWith("T") || state.startsWith("Z")) {
            issues.push({
              type: "version-lock",
              severity: "warning",
              detail: `Stale claude ${version} (PID ${pid}, state ${state})`,
            });
          }
        }
      }
    }
  } catch (err) {
    logger.debug("claude-health:version-lock-check-error", {
      err: String(err),
    });
  }
  return issues;
}

async function validateMcpFile(filePath: string): Promise<HealthIssue[]> {
  let content: string;
  try {
    content = await Bun.file(filePath).text();
  } catch {
    return []; // missing = fine
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return [
      {
        type: "mcp-parse",
        severity: "error",
        file: filePath,
        detail: `Invalid JSON in ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
      },
    ];
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [
      {
        type: "mcp-schema",
        severity: "error",
        file: filePath,
        detail: `${filePath}: root must be an object`,
      },
    ];
  }

  const obj = parsed as Record<string, unknown>;
  const issues: HealthIssue[] = [];

  // Flat format required — mcpServers wrapper is wrong
  if ("mcpServers" in obj) {
    issues.push({
      type: "mcp-schema",
      severity: "warning",
      file: filePath,
      detail: `${filePath}: uses mcpServers wrapper (should be flat format)`,
    });
    return issues;
  }

  // Validate each server has command or type
  for (const [name, server] of Object.entries(obj)) {
    if (typeof server !== "object" || server === null) {
      issues.push({
        type: "mcp-schema",
        severity: "error",
        file: filePath,
        detail: `${filePath}: server "${name}" is not an object`,
      });
      continue;
    }
    const s = server as Record<string, unknown>;
    if (typeof s.command !== "string" && typeof s.type !== "string") {
      issues.push({
        type: "mcp-schema",
        severity: "error",
        file: filePath,
        detail: `${filePath}: server "${name}" missing "command" or "type"`,
      });
    }
  }

  return issues;
}

async function checkMcpConfigs(): Promise<HealthIssue[]> {
  const all: HealthIssue[] = [];
  for (const f of MCP_CONFIG_FILES) {
    all.push(...(await validateMcpFile(f)));
  }
  return all;
}

// ── Repairs ───────────────────────────────────────────────────────────────────

async function repairVersionLock(issue: HealthIssue): Promise<boolean> {
  const match = issue.detail.match(/PID (\d+)/);
  if (!match) return false;
  const pid = parseInt(match[1]!);
  try {
    process.kill(pid, "SIGTERM");
    logger.info("claude-health:repair:killed-stale", { pid });
    return true;
  } catch {
    return false;
  }
}

async function repairMcpSchema(issue: HealthIssue): Promise<boolean> {
  if (!issue.file) return false;
  // Only auto-fix project file — never touch global ~/.mcp.json
  if (!issue.file.includes("eddie/.mcp.json")) return false;
  if (issue.type !== "mcp-schema") return false;
  await Bun.write(issue.file, "{}\n");
  logger.info("claude-health:repair:mcp-rewrite", { file: issue.file });
  return true;
}

async function applyRepairs(issues: HealthIssue[]): Promise<void> {
  for (const issue of issues) {
    if (issue.type === "version-lock") {
      issue.autoFixed = await repairVersionLock(issue);
    } else if (issue.type === "mcp-schema") {
      issue.autoFixed = await repairMcpSchema(issue);
    }
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function runCheck(bot: Bot): Promise<void> {
  logger.info("claude-health:check");

  const issues: HealthIssue[] = [
    ...(await checkVersionLocks()),
    ...(await checkMcpConfigs()),
  ];

  if (config.INTEGRITY_CHECK_ENABLED) {
    const { checkIntegrity } = await import("../security/integrity.ts");
    const integrityIssues = await checkIntegrity().catch(() => [] as never[]);
    for (const issue of integrityIssues) {
      logger.warn("integrity:changed", {
        file: issue.file,
        status: issue.status,
        detail: issue.detail,
      });
    }
  }

  if (config.HOOKS_VALIDATION_ENABLED) {
    const { validateHooks } = await import("../security/hooks-validator.ts");
    const hooksResult = await validateHooks().catch(() => null);
    if (hooksResult && !hooksResult.valid) {
      logger.warn("claude-health:suspicious-hooks", {
        suspicious: hooksResult.suspicious,
        approved: hooksResult.approved,
      });
      for (const hook of hooksResult.suspicious) {
        logger.warn("claude-health:suspicious-hook-detail", { hook });
      }
    }
  }

  if (issues.length === 0) {
    logger.info("claude-health:healthy");
    return;
  }

  await applyRepairs(issues);

  const fixed = issues.filter((i) => i.autoFixed);
  const remaining = issues.filter((i) => !i.autoFixed);
  const errors = remaining.filter((i) => i.severity === "error");

  logger.info("claude-health:done", {
    total: issues.length,
    fixed: fixed.length,
    remaining: remaining.length,
  });

  if (fixed.length > 0 || errors.length > 0) {
    const lines: string[] = ["[claude-health]"];
    if (fixed.length > 0)
      lines.push(`✅ fixed: ${fixed.map((i) => i.detail).join(" | ")}`);
    if (errors.length > 0)
      lines.push(
        `⚠️ needs attention: ${errors.map((i) => i.detail).join(" | ")}`,
      );

    bot.api
      .sendMessage({
        chat_id: config.OWNER_TELEGRAM_ID,
        text: lines.join("\n"),
      })
      .catch(() => {});
  }

  // Escalate unresolved errors to self-heal
  if (errors.length > 0 && config.SELF_HEAL_ENABLED) {
    const { triggerSelfHeal } = await import("../jobs/self-heal.ts");
    for (const issue of errors) {
      await triggerSelfHeal(
        {
          source: "claude-health",
          name: issue.type,
          error: issue.detail,
          timestamp: Date.now(),
        },
        bot,
      );
    }
  }

  if (config.CONTEXT_DRIFT_ENABLED) {
    await checkContextDrift(bot).catch((err) =>
      logger.warn("health:context-drift-error", { error: String(err) }),
    );
  }
}

export function startClaudeHealth(bot: Bot): void {
  logger.info("claude-health:scheduled", { intervalMs: INTERVAL_MS });
  if (config.INTEGRITY_CHECK_ENABLED) {
    import("../security/integrity.ts").then(({ initBaseline }) =>
      initBaseline().catch((err) =>
        logger.warn("integrity:baseline-error", { error: String(err) }),
      ),
    );
  }
  runCheck(bot).catch((err) =>
    logger.warn("claude-health:error", { error: String(err) }),
  );
  setInterval(
    () =>
      runCheck(bot).catch((err) =>
        logger.warn("claude-health:error", { error: String(err) }),
      ),
    INTERVAL_MS,
  );
}
