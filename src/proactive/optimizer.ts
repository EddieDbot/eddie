import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { readdir } from "node:fs/promises";

type Severity = "HIGH" | "MEDIUM" | "LOW";

interface Finding {
  category: string;
  status: "OK" | "WARN" | "FLAG";
  detail: string;
  severity: Severity;
}

export interface AuditResult {
  date: string;
  healthScore: number;
  findings: Finding[];
  topFixes: string[];
}

const AGENTS_DIR = resolve(homedir(), ".claude/agents");
const CAPABILITIES_PATH = resolve(homedir(), "eddie/src/routing/capabilities.ts");

function spawnSync(cmd: string): string {
  const proc = Bun.spawnSync(["bash", "-c", cmd], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.stdout?.toString().trim() ?? "";
}

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hour: h ?? 3, minute: m ?? 0 };
}

function msUntilTime(hour: number, minute: number, timezone: string): number {
  const now = new Date();
  const nowLocal = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const target = new Date(nowLocal);
  target.setHours(hour, minute, 0, 0);
  if (target <= nowLocal) target.setDate(target.getDate() + 1);
  return target.getTime() - nowLocal.getTime();
}

function auditZombieSessions(): Finding {
  try {
    const allowlist = new Set([
      "eddie",
      "video-test",
      "video-pipeline-test",
      "eddie-remote-control",
    ]);
    const out = spawnSync(
      `tmux list-sessions -F "#{session_name} #{session_created}" 2>/dev/null | awk '{print $0, systime()-$2}' | awk '$3 > 3600'`,
    );
    if (!out) {
      return { category: "Zombie Sessions", status: "OK", detail: "No stale sessions", severity: "HIGH" };
    }
    const zombies = out
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[0] ?? "")
      .filter((name) => !allowlist.has(name));
    if (zombies.length === 0) {
      return { category: "Zombie Sessions", status: "OK", detail: "No stale non-allowlisted sessions", severity: "HIGH" };
    }
    return {
      category: "Zombie Sessions",
      status: "FLAG",
      detail: `${zombies.length} stale session(s): ${zombies.join(", ")}`,
      severity: "HIGH",
    };
  } catch (err) {
    return { category: "Zombie Sessions", status: "OK", detail: `Audit error: ${String(err)}`, severity: "HIGH" };
  }
}

async function auditCapabilitiesDrift(): Promise<Finding> {
  try {
    const allFiles = await readdir(AGENTS_DIR).catch(() => [] as string[]);
    const excluded = new Set(["CHANGELOG.md", "README.md", "_template.md", "CLAUDE.md"]);
    const agentFiles = allFiles
      .filter((f) => f.endsWith(".md") && !excluded.has(f))
      .map((f) => f.replace(/\.md$/, ""));

    const capContent = await Bun.file(CAPABILITIES_PATH).text().catch(() => "");
    const capAgentIds = new Set<string>();
    const matches = capContent.matchAll(/["'`]agent:([^"'`\s]+)["'`]/g);
    for (const m of matches) {
      if (m[1]) capAgentIds.add(m[1]);
    }

    const missing = agentFiles.filter((a) => !capAgentIds.has(a));
    const extra = [...capAgentIds].filter((a) => !agentFiles.includes(a));

    if (missing.length === 0 && extra.length === 0) {
      return { category: "Capabilities Drift", status: "OK", detail: `${agentFiles.length} agents in sync`, severity: "HIGH" };
    }
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`agents missing from capabilities.ts: ${missing.join(", ")}`);
    if (extra.length > 0) parts.push(`stale entries in capabilities.ts: ${extra.join(", ")}`);
    return {
      category: "Capabilities Drift",
      status: "FLAG",
      detail: parts.join("; "),
      severity: "HIGH",
    };
  } catch (err) {
    return { category: "Capabilities Drift", status: "OK", detail: `Audit error: ${String(err)}`, severity: "HIGH" };
  }
}

function auditDiskBloat(): Finding {
  try {
    const jobCount = parseInt(spawnSync("ls ~/eddie/data/jobs/ 2>/dev/null | wc -l") || "0", 10);
    const staleStateCount = parseInt(
      spawnSync(`ls ~/brain-vault/90\\ -\\ Agent\\ Memory/State/ 2>/dev/null | grep -E "daily-brief|handoff|cli-comparison" | wc -l`) || "0",
      10,
    );
    const tempCount = parseInt(
      spawnSync("ls /tmp/eddie-* /tmp/job-* /tmp/out.log 2>/dev/null 2>&1 | wc -l") || "0",
      10,
    );
    const logSizeRaw = spawnSync("du -sh ~/eddie/logs/ 2>/dev/null || echo '0'");

    const issues: string[] = [];
    if (jobCount > 200) issues.push(`${jobCount} job files (>200)`);
    if (staleStateCount > 5) issues.push(`${staleStateCount} stale state files`);
    if (tempCount > 10) issues.push(`${tempCount} temp files`);

    const detail = issues.length > 0
      ? issues.join("; ") + ` | logs: ${logSizeRaw}`
      : `jobs:${jobCount} stale-state:${staleStateCount} tmp:${tempCount} logs:${logSizeRaw}`;

    return {
      category: "Disk Bloat",
      status: issues.length > 0 ? "FLAG" : "OK",
      detail,
      severity: "MEDIUM",
    };
  } catch (err) {
    return { category: "Disk Bloat", status: "OK", detail: `Audit error: ${String(err)}`, severity: "MEDIUM" };
  }
}

function auditModelRouting(): Finding {
  try {
    const files = spawnSync("ls ~/eddie/data/jobs/*.json 2>/dev/null | head -50");
    if (!files) {
      return { category: "Model Routing", status: "OK", detail: "No job files found", severity: "MEDIUM" };
    }
    const modelCounts: Record<string, number> = {};
    let total = 0;
    for (const f of files.split("\n").filter(Boolean)) {
      const modelLine = spawnSync(`grep '"model"' "${f}" 2>/dev/null | head -1`);
      const match = modelLine.match(/"model"\s*:\s*"([^"]+)"/);
      if (match?.[1]) {
        const m = match[1];
        modelCounts[m] = (modelCounts[m] ?? 0) + 1;
        total++;
      }
    }
    if (total === 0) {
      return { category: "Model Routing", status: "OK", detail: "No model data in job files", severity: "MEDIUM" };
    }
    const topModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0];
    const topPct = topModel ? Math.round((topModel[1] / total) * 100) : 0;
    const detail = `top model: ${topModel?.[0] ?? "?"} (${topPct}% of ${total} jobs)`;
    return {
      category: "Model Routing",
      status: topPct > 80 ? "WARN" : "OK",
      detail,
      severity: "MEDIUM",
    };
  } catch (err) {
    return { category: "Model Routing", status: "OK", detail: `Audit error: ${String(err)}`, severity: "MEDIUM" };
  }
}

function auditRunPromptMigration(): Finding {
  try {
    const holdouts = new Set(["relay.ts", "script-generator.ts", "contra-intake.ts"]);
    const raw = spawnSync(
      `grep -r "runPrompt(" ~/eddie/src/ --include="*.ts" -l 2>/dev/null | grep -v "run-prompt" | grep -v "run-prompt-multi"`,
    );
    if (!raw) {
      return { category: "runPrompt Migration", status: "OK", detail: "All call sites migrated", severity: "MEDIUM" };
    }
    const remaining = raw
      .split("\n")
      .filter(Boolean)
      .map((f) => f.split("/").pop() ?? f)
      .filter((f) => !holdouts.has(f));

    if (remaining.length === 0) {
      return { category: "runPrompt Migration", status: "OK", detail: "Only known holdouts remain", severity: "MEDIUM" };
    }
    return {
      category: "runPrompt Migration",
      status: "FLAG",
      detail: `${remaining.length} file(s) still using runPrompt(): ${remaining.join(", ")}`,
      severity: "MEDIUM",
    };
  } catch (err) {
    return { category: "runPrompt Migration", status: "OK", detail: `Audit error: ${String(err)}`, severity: "MEDIUM" };
  }
}

function auditJobBriefingSizes(): Finding {
  try {
    const raw = spawnSync("ls -la ~/eddie/data/jobs/*system* 2>/dev/null | sort -k5 -rn | head -5");
    if (!raw) {
      return { category: "Job Briefing Sizes", status: "OK", detail: "No system job files found", severity: "MEDIUM" };
    }
    const oversized: string[] = [];
    for (const line of raw.split("\n").filter(Boolean)) {
      const parts = line.split(/\s+/);
      const size = parseInt(parts[4] ?? "0", 10);
      const name = parts[parts.length - 1]?.split("/").pop() ?? "?";
      if (size > 51200) {
        oversized.push(`${name} (${Math.round(size / 1024)}KB)`);
      }
    }
    if (oversized.length === 0) {
      return { category: "Job Briefing Sizes", status: "OK", detail: "All system files under 50KB", severity: "MEDIUM" };
    }
    return {
      category: "Job Briefing Sizes",
      status: "FLAG",
      detail: `Oversized briefings: ${oversized.join(", ")}`,
      severity: "MEDIUM",
    };
  } catch (err) {
    return { category: "Job Briefing Sizes", status: "OK", detail: `Audit error: ${String(err)}`, severity: "MEDIUM" };
  }
}

function auditContextWaste(): Finding {
  try {
    const briefCount = parseInt(
      spawnSync(`ls ~/brain-vault/90\\ -\\ Agent\\ Memory/State/daily-brief-* 2>/dev/null | wc -l`) || "0",
      10,
    );
    const oldJobCount = parseInt(
      spawnSync("find ~/eddie/data/jobs/ -name '*.json' -mtime +7 2>/dev/null | wc -l") || "0",
      10,
    );
    const issues: string[] = [];
    if (briefCount > 3) issues.push(`${briefCount} daily-brief files in State (>3)`);
    if (oldJobCount > 50) issues.push(`${oldJobCount} job files >7d old`);

    return {
      category: "Context Waste",
      status: issues.length > 0 ? "WARN" : "OK",
      detail: issues.length > 0 ? issues.join("; ") : `briefs:${briefCount} old-jobs:${oldJobCount}`,
      severity: "MEDIUM",
    };
  } catch (err) {
    return { category: "Context Waste", status: "OK", detail: `Audit error: ${String(err)}`, severity: "MEDIUM" };
  }
}

async function auditAgentQuality(): Promise<Finding> {
  try {
    const excluded = new Set(["CHANGELOG.md", "README.md", "_template.md", "CLAUDE.md"]);
    const allFiles = await readdir(AGENTS_DIR).catch(() => [] as string[]);
    const agentFiles = allFiles.filter((f) => f.endsWith(".md") && !excluded.has(f));

    const issues: string[] = [];
    for (const file of agentFiles) {
      const path = resolve(AGENTS_DIR, file);
      const lineCount = parseInt(spawnSync(`wc -l < "${path}" 2>/dev/null`) || "0", 10);
      const firstLine = spawnSync(`head -1 "${path}" 2>/dev/null`);
      if (lineCount > 200) issues.push(`${file} (${lineCount} lines, too long)`);
      if (!firstLine.startsWith("---")) issues.push(`${file} (missing YAML frontmatter)`);
    }

    if (issues.length === 0) {
      return { category: "Agent Quality", status: "OK", detail: `${agentFiles.length} agents checked`, severity: "MEDIUM" };
    }
    return {
      category: "Agent Quality",
      status: "WARN",
      detail: issues.slice(0, 5).join("; ") + (issues.length > 5 ? ` +${issues.length - 5} more` : ""),
      severity: "MEDIUM",
    };
  } catch (err) {
    return { category: "Agent Quality", status: "OK", detail: `Audit error: ${String(err)}`, severity: "MEDIUM" };
  }
}

function auditStateFiles(): Finding {
  try {
    const count = parseInt(
      spawnSync(`ls ~/brain-vault/90\\ -\\ Agent\\ Memory/State/ 2>/dev/null | wc -l`) || "0",
      10,
    );
    return {
      category: "State Files",
      status: count > 20 ? "FLAG" : "OK",
      detail: `${count} state files${count > 20 ? " (>20, prune recommended)" : ""}`,
      severity: "LOW",
    };
  } catch (err) {
    return { category: "State Files", status: "OK", detail: `Audit error: ${String(err)}`, severity: "LOW" };
  }
}

function auditParallelOpportunities(): Finding {
  try {
    const raw = spawnSync(
      `grep -rn "for.*await" ~/eddie/src/ --include="*.ts" 2>/dev/null | grep -v "node_modules" | head -10`,
    );
    const count = raw ? raw.split("\n").filter(Boolean).length : 0;
    return {
      category: "Parallel Opportunities",
      status: count > 5 ? "WARN" : "OK",
      detail: `${count} sequential for-await loop(s) found${count > 5 ? " — consider Promise.all" : ""}`,
      severity: "LOW",
    };
  } catch (err) {
    return { category: "Parallel Opportunities", status: "OK", detail: `Audit error: ${String(err)}`, severity: "LOW" };
  }
}

function calculateHealthScore(findings: Finding[]): number {
  let score = 10;
  for (const f of findings) {
    if (f.severity === "HIGH" && f.status === "FLAG") score -= 2;
    else if (f.severity === "HIGH" && f.status === "WARN") score -= 1;
    else if (f.severity === "MEDIUM" && f.status === "FLAG") score -= 1;
    else if (f.severity === "MEDIUM" && f.status === "WARN") score -= 0.5;
    else if (f.severity === "LOW" && f.status === "FLAG") score -= 0.5;
  }
  return Math.max(0, Math.min(10, score));
}

const SEVERITY_ORDER: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function getTopFixes(findings: Finding[]): string[] {
  return findings
    .filter((f) => f.status === "FLAG" || f.status === "WARN")
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, 3)
    .map((f) => `[${f.severity}] ${f.category}: ${f.detail}`);
}

async function writeReport(result: AuditResult): Promise<void> {
  const stateDir = `${config.BRAIN_VAULT_PATH}/90 - Agent Memory/State`;
  const path = `${stateDir}/optimizer-report.md`;

  const rows = result.findings
    .map((f) => `| ${f.category} | ${f.status} | ${f.detail} |`)
    .join("\n");

  const fixes = result.topFixes.length > 0
    ? result.topFixes.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "_No actionable issues found._";

  const content = `## OPTIMIZER AUDIT — ${result.date}

### Health Score: ${result.healthScore}/10

| Category | Status | Detail |
|----------|--------|--------|
${rows}

### Top 3 Actionable Fixes
${fixes}
`;

  try {
    await Bun.write(path, content);
    logger.info("optimizer:report-written", { path });
  } catch (err) {
    logger.error("optimizer:report-write-failed", { error: String(err) });
  }
}

export async function runOptimizer(bot?: import("gramio").Bot): Promise<AuditResult> {
  logger.info("optimizer:start");

  const [
    zombies,
    capsDrift,
    diskBloat,
    modelRouting,
    runPromptMigration,
    jobSizes,
    contextWaste,
    agentQuality,
    stateFiles,
    parallelOps,
  ] = await Promise.all([
    Promise.resolve(auditZombieSessions()),
    auditCapabilitiesDrift(),
    Promise.resolve(auditDiskBloat()),
    Promise.resolve(auditModelRouting()),
    Promise.resolve(auditRunPromptMigration()),
    Promise.resolve(auditJobBriefingSizes()),
    Promise.resolve(auditContextWaste()),
    auditAgentQuality(),
    Promise.resolve(auditStateFiles()),
    Promise.resolve(auditParallelOpportunities()),
  ]);

  const findings = [
    zombies,
    capsDrift,
    diskBloat,
    modelRouting,
    runPromptMigration,
    jobSizes,
    contextWaste,
    agentQuality,
    stateFiles,
    parallelOps,
  ];

  const healthScore = calculateHealthScore(findings);
  const topFixes = getTopFixes(findings);
  const date = new Date().toISOString().split("T")[0]!;

  const result: AuditResult = { date, healthScore, findings, topFixes };

  await writeReport(result);

  const hasHighFlag = findings.some((f) => f.severity === "HIGH" && f.status === "FLAG");
  if (bot && (hasHighFlag || healthScore < 7)) {
    const lines = [
      `OPTIMIZER AUDIT — ${date}`,
      `Health Score: ${healthScore}/10`,
      "",
      ...topFixes,
    ].join("\n");
    await bot.api
      .sendMessage({ chat_id: config.OWNER_TELEGRAM_ID, text: lines })
      .catch((err) => logger.error("optimizer:telegram-failed", { error: String(err) }));
  }

  logger.info("optimizer:done", { healthScore, issues: topFixes.length });
  return result;
}

export function startOptimizer(bot: import("gramio").Bot): void {
  const time = "OPTIMIZER_TIME" in config ? (config as Record<string, unknown>).OPTIMIZER_TIME as string : "03:00";
  const { hour, minute } = parseTime(time ?? "03:00");
  const delay = msUntilTime(hour, minute, config.TIMEZONE);
  logger.info("optimizer:scheduled", { time, delayMs: delay });

  setTimeout(() => {
    runOptimizer(bot).catch((err) =>
      logger.error("optimizer:run-error", { error: String(err) }),
    );
    setInterval(
      () =>
        runOptimizer(bot).catch((err) =>
          logger.error("optimizer:run-error", { error: String(err) }),
        ),
      24 * 60 * 60 * 1000,
    );
  }, delay);
}

if (import.meta.main) {
  const result = await runOptimizer();
  console.log(JSON.stringify(result, null, 2));
}
