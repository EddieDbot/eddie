import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const MCP_CONFIG_FILES = [
  resolve(HOME, ".mcp.json"),
  resolve(HOME, "eddie/.mcp.json"),
];
const AUDIT_LOG_PATH = resolve(HOME, "brain-vault/90 - Agent Memory/Learnings/mcp-audit-log.md");

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

function assessRisk(entry: McpEntry): { risk: AuditEntry["risk"]; note: string } {
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

export async function runMcpAudit(): Promise<AuditEntry[]> {
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
        entries.push({ timestamp, configFile, mcpName: name, command: entry.command, risk, note });
      }
    } catch {
      // Config file missing or invalid — skip
    }
  }

  // Write audit log
  if (entries.length > 0) {
    const lines = [
      `## MCP Audit — ${new Date().toLocaleDateString()}\n`,
      ...entries.map(e => `- **${e.mcpName}** [${e.risk.toUpperCase()}] — ${e.note}${e.command ? `\n  Command: \`${e.command.slice(0, 80)}\`` : ""}`),
      "",
    ];

    let existing = "";
    try { existing = await Bun.file(AUDIT_LOG_PATH).text(); } catch {}
    await Bun.write(AUDIT_LOG_PATH, lines.join("\n") + "\n" + existing);
    logger.info("mcp-audit:complete", { count: entries.length });
  }

  return entries;
}
