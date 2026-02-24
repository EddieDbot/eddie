import { getSupabase, memoryEnabled } from "./client.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { CAPABILITIES } from "../routing/capabilities.ts";

export type ToolTickEntry = {
  tool_type: string; // "model" | "mcp" | "agent" | "script"
  tool_name: string;
  job_id?: string;
  duration_ms?: number;
  success?: boolean;
  context?: string;
  metadata?: Record<string, unknown>;
};

export async function tickTool(entry: ToolTickEntry): Promise<void> {
  if (!memoryEnabled || !config.TOOL_TICKER_ENABLED) return;
  try {
    const { error } = await getSupabase().from("tool_usage_log").insert(entry);
    if (error) logger.warn("tool-ticker:log-error", { error: error.message });
  } catch (err) {
    logger.warn("tool-ticker:log-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

type ToolUsageRow = {
  tool_type: string;
  tool_name: string;
  count: number;
  success_rate: number;
};

export async function getToolUsageSummary(days = 7): Promise<{
  topTools: ToolUsageRow[];
  unusedTools: string[];
}> {
  if (!memoryEnabled) return { topTools: [], unusedTools: [] };
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    const { data, error } = await getSupabase()
      .from("tool_usage_log")
      .select("tool_type, tool_name, success")
      .gte("created_at", since);
    if (error || !data) return { topTools: [], unusedTools: [] };

    const counts: Record<string, { count: number; successes: number; tool_type: string }> = {};
    for (const row of data) {
      const key = `${row.tool_type}:${row.tool_name}`;
      if (!counts[key]) counts[key] = { count: 0, successes: 0, tool_type: row.tool_type };
      counts[key]!.count++;
      if (row.success) counts[key]!.successes++;
    }

    const topTools: ToolUsageRow[] = Object.entries(counts)
      .map(([key, v]) => {
        const [, tool_name] = key.split(":");
        return {
          tool_type: v.tool_type,
          tool_name: tool_name ?? key,
          count: v.count,
          success_rate: v.count > 0 ? v.successes / v.count : 0,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Cross-reference against known capabilities to find unused ones
    const usedKeys = new Set(data.map((r) => `${r.tool_type}:${r.tool_name}`));
    const unusedTools = CAPABILITIES
      .filter((c) => c.type !== "command" && !usedKeys.has(`${c.type}:${c.id.split(":")[1]}`))
      .map((c) => c.id)
      .slice(0, 20);

    return { topTools, unusedTools };
  } catch {
    return { topTools: [], unusedTools: [] };
  }
}

export async function getUnusedTools(days = 30): Promise<string[]> {
  const { unusedTools } = await getToolUsageSummary(days);
  return unusedTools;
}

export async function formatToolUsageSummary(days = 7): Promise<string> {
  const { topTools, unusedTools } = await getToolUsageSummary(days);
  if (topTools.length === 0) return "No tool usage data.";
  const topLines = topTools
    .map((t) => `  ${t.tool_type}:${t.tool_name} — ${t.count}x (${Math.round(t.success_rate * 100)}% success)`)
    .join("\n");
  const unusedLines = unusedTools.length > 0 ? `\nUnused (${days}d):\n${unusedTools.map((t) => `  ${t}`).join("\n")}` : "";
  return `Top tools (${days}d):\n${topLines}${unusedLines}`;
}

export function parseToolInvocationsFromOutput(output: string): string[] {
  const tools: string[] = [];
  // MCP tool invocations: mcp__toolname__method or ToolSearch patterns
  const mcpMatches = output.matchAll(/mcp__([a-z_-]+)__\w+/g);
  for (const m of mcpMatches) {
    if (m[1]) tools.push(`mcp:${m[1]}`);
  }
  // Agent invocations
  const agentMatches = output.matchAll(/subagent_type['":\s]+([a-z-]+)/g);
  for (const m of agentMatches) {
    if (m[1]) tools.push(`agent:${m[1]}`);
  }
  return [...new Set(tools)];
}
