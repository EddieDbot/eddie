import { getSupabase, memoryEnabled } from "./client.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

function aggregateRows(
  data: Array<{
    input_tokens: number;
    output_tokens: number;
    est_cost_usd: number;
    source: string;
  }>,
): UsageSummary {
  const bySource: UsageSummary["bySource"] = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  for (const row of data) {
    totalInputTokens += row.input_tokens ?? 0;
    totalOutputTokens += row.output_tokens ?? 0;
    totalCostUsd += Number(row.est_cost_usd ?? 0);
    const src = row.source ?? "unknown";
    if (!bySource[src])
      bySource[src] = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    bySource[src]!.inputTokens += row.input_tokens ?? 0;
    bySource[src]!.outputTokens += row.output_tokens ?? 0;
    bySource[src]!.costUsd += Number(row.est_cost_usd ?? 0);
  }
  return { totalInputTokens, totalOutputTokens, totalCostUsd, bySource };
}

export type UsageEntry = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  est_cost_usd: number;
  source: string; // "relay" | "heartbeat" | "cron" | "job" | "voice"
};

export async function logUsage(entry: UsageEntry): Promise<void> {
  if (!memoryEnabled || !config.COST_TRACKING_ENABLED) return;
  try {
    const { error } = await getSupabase().from("usage_log").insert(entry);
    if (error) logger.warn("usage:log-error", { error: error.message });
  } catch (err) {
    logger.warn("usage:log-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export type UsageSummary = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  bySource: Record<
    string,
    { inputTokens: number; outputTokens: number; costUsd: number }
  >;
};

const EMPTY: UsageSummary = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCostUsd: 0,
  bySource: {},
};

export async function getUsageSince(since: string): Promise<UsageSummary> {
  if (!memoryEnabled) return EMPTY;
  const { data, error } = await getSupabase()
    .from("usage_log")
    .select("input_tokens, output_tokens, est_cost_usd, source")
    .gte("created_at", since);
  if (error || !data) return EMPTY;
  return aggregateRows(data);
}

export async function getUsageSummary(days = 7): Promise<UsageSummary> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return getUsageSince(since);
}

function weekStartCT(tz: string): Date {
  const local = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const daysFromMon = (local.getDay() + 6) % 7;
  const d = new Date(local);
  d.setDate(d.getDate() - daysFromMon);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthStartCT(tz: string): Date {
  const local = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  return new Date(local.getFullYear(), local.getMonth(), 1, 0, 0, 0, 0);
}

function nextMondayCT(tz: string): Date {
  const local = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const daysUntilMon = (8 - local.getDay()) % 7 || 7;
  const d = new Date(local);
  d.setDate(d.getDate() + daysUntilMon);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtTokens(u: UsageSummary): string {
  const k = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  return `${k(u.totalInputTokens)} in + ${k(u.totalOutputTokens)} out = $${u.totalCostUsd.toFixed(3)}`;
}

export async function buildUsageBlock(
  lastHeartbeatAt: string | null,
  tz: string,
): Promise<string> {
  const weekStart = weekStartCT(tz);
  const monthStart = monthStartCT(tz);
  const nextWeekReset = nextMondayCT(tz);
  const nextMonthReset = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() + 1,
    1,
  );
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const [delta, weekly, monthly] = await Promise.all([
    lastHeartbeatAt ? getUsageSince(lastHeartbeatAt) : Promise.resolve(EMPTY),
    getUsageSince(weekStart.toISOString()),
    getUsageSince(monthStart.toISOString()),
  ]);

  const lines = [
    `Since last heartbeat: ${fmtTokens(delta)}`,
    `This week (resets ${fmt(nextWeekReset)}): ${fmtTokens(weekly)}`,
    `This month (resets ${fmt(nextMonthReset)}): ${fmtTokens(monthly)}`,
  ];

  const sources = Object.entries(weekly.bySource)
    .filter(([, v]) => v.costUsd > 0)
    .sort(([, a], [, b]) => b.costUsd - a.costUsd)
    .map(([src, v]) => `  ${src}: $${v.costUsd.toFixed(3)}`);
  if (sources.length > 0) lines.push("By source (week):", ...sources);

  return lines.join("\n");
}
