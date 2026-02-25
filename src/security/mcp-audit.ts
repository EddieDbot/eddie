import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { readdir, stat } from "node:fs/promises";
import type { Bot } from "gramio";

const HOME = homedir();
const MCP_CONFIG_FILES = [
  resolve(HOME, ".mcp.json"),
  resolve(HOME, "eddie/.mcp.json"),
];
const AUDIT_LOG_PATH = resolve(
  HOME,
  "brain-vault/90 - Agent Memory/Learnings/mcp-audit-log.md",
);

type McpEntry = {
  name: string;
  command?: string;
  url?: string;
  [key: string]: unknown;
};

type AuditEntry = {
  timestamp: string;
  configFile: string;
  mcpName: string;
  command?: string;
  risk: "low" | "medium" | "high";
  note: string;
};

function assessRisk(entry: McpEntry): {
  risk: AuditEntry["risk"];
  note: string;
} {
  // External URL MCPs = higher risk
  if (entry.url && !entry.url.includes("localhost")) {
    return { risk: "high", note: "External URL endpoint" };
  }
  // Network-capable commands
  if (entry.command && /curl|wget|fetch|http/i.test(entry.command)) {
    return { risk: "medium", note: "Network-capable command" };
  }
  // Browser automation
  if (entry.name && /playwright|puppeteer|browser/i.test(entry.name)) {
    return { risk: "medium", note: "Browser automation" };
  }
  return { risk: "low", note: "Standard MCP" };
}

type UnusedServer = { name: string; lastSeen: Date | null };

const JOBS_DIR = resolve(HOME, "eddie/data/jobs");

async function detectUnusedServers(): Promise<UnusedServer[]> {
  const mcpNames: string[] = [];
  for (const configFile of MCP_CONFIG_FILES) {
    try {
      const raw = await Bun.file(configFile).text();
      const parsed = JSON.parse(raw);
      const mcpServers = parsed.mcpServers ?? parsed.mcp ?? {};
      mcpNames.push(...Object.keys(mcpServers));
    } catch {}
  }
  if (mcpNames.length === 0) return [];

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let outputFiles: string[] = [];
  try {
    const allFiles = await readdir(JOBS_DIR);
    outputFiles = allFiles.filter((f) => f.endsWith("-output.txt"));
  } catch {
    return mcpNames.map((name) => ({ name, lastSeen: null }));
  }

  const recentFiles: string[] = [];
  for (const f of outputFiles) {
    try {
      const s = await stat(resolve(JOBS_DIR, f));
      if (s.mtimeMs >= thirtyDaysAgo) recentFiles.push(f);
    } catch {}
  }

  const unused: UnusedServer[] = [];
  for (const name of mcpNames) {
    let found = false;
    for (const f of recentFiles) {
      try {
        const content = await Bun.file(resolve(JOBS_DIR, f)).text();
        if (content.includes(name)) {
          found = true;
          break;
        }
      } catch {}
    }
    if (!found) unused.push({ name, lastSeen: null });
  }

  return unused;
}

export async function runMcpAudit(bot?: Bot): Promise<AuditEntry[]> {
  if (!config.MCP_AUDIT_LOG_ENABLED) return [];

  const entries: AuditEntry[] = [];
  const timestamp = new Date().toISOString();

  for (const configFile of MCP_CONFIG_FILES) {
    try {
      const raw = await Bun.file(configFile).text();
      const parsed = JSON.parse(raw);
      const mcpServers = parsed.mcpServers ?? parsed.mcp ?? {};

      for (const [name, mcpConfig] of Object.entries(mcpServers)) {
        const entry = mcpConfig as McpEntry;
        const { risk, note } = assessRisk({ ...entry, name });
        entries.push({
          timestamp,
          configFile,
          mcpName: name,
          command: entry.command,
          risk,
          note,
        });
      }
    } catch {
      // Config file missing or invalid — skip
    }
  }

  const unusedServers = await detectUnusedServers();

  // Write audit log
  if (entries.length > 0) {
    const lines = [
      `## MCP Audit — ${new Date().toLocaleDateString()}\n`,
      ...entries.map(
        (e) =>
          `- **${e.mcpName}** [${e.risk.toUpperCase()}] — ${e.note}${e.command ? `\n  Command: \`${e.command.slice(0, 80)}\`` : ""}`,
      ),
      "",
    ];
    if (unusedServers.length > 0) {
      lines.push(`### Unused servers (30d)\n`);
      lines.push(...unusedServers.map((s) => `- ${s.name}`), "");
    }

    let existing = "";
    try {
      existing = await Bun.file(AUDIT_LOG_PATH).text();
    } catch {}
    await Bun.write(AUDIT_LOG_PATH, lines.join("\n") + "\n" + existing);
    logger.info("mcp-audit:complete", {
      count: entries.length,
      unused: unusedServers.length,
    });
  }

  // Telegram alert on HIGH risk or unused servers
  if (bot) {
    const highRisk = entries.filter((e) => e.risk === "high");
    if (highRisk.length > 0 || unusedServers.length > 0) {
      const parts: string[] = ["MCP Audit Alert"];
      if (highRisk.length > 0) {
        parts.push(
          `\nHIGH risk servers:\n${highRisk.map((e) => `- ${e.mcpName} — ${e.note}`).join("\n")}`,
        );
      }
      if (unusedServers.length > 0) {
        parts.push(
          `\nUnused (30d):\n${unusedServers.map((s) => `- ${s.name}`).join("\n")}`,
        );
      }
      try {
        await bot.api.sendMessage({
          chat_id: config.OWNER_TELEGRAM_ID,
          text: parts.join("\n"),
        });
      } catch (err) {
        logger.warn("mcp-audit:telegram-alert-failed", {
          error: String(err),
        });
      }
    }
  }

  return entries;
}
