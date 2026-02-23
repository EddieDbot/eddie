import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";

const HOME = process.env.HOME ?? "/home/na";
const LEARNINGS_DIR = resolve(HOME, "brain-vault/90 - Agent Memory/Learnings");

function getWeekNumber(): { year: number; week: number } {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return { year: now.getFullYear(), week };
}

export async function gatherWeeklyData(): Promise<{
  successRate: number;
  totalJobs: number;
  topFailures: string[];
  healCount: number;
  avgDurationMin: number;
}> {
  if (!memoryEnabled) return { successRate: 0, totalJobs: 0, topFailures: [], healCount: 0, avgDurationMin: 0 };

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data: jobs } = await getSupabase()
      .from("jobs")
      .select("outcome, duration_ms, error, outcome_summary")
      .gte("started_at", since)
      .eq("status", "completed");

    const total = jobs?.length ?? 0;
    const success = jobs?.filter((j) => j.outcome === "success").length ?? 0;
    const failures = jobs
      ?.filter((j) => j.outcome === "failed")
      .map((j) => (j.outcome_summary || j.error || "unknown").slice(0, 80))
      .slice(0, 5) ?? [];

    const durations = jobs?.filter((j) => j.duration_ms).map((j) => j.duration_ms as number) ?? [];
    const avgMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    const { data: heals } = await getSupabase()
      .from("self_heal_log")
      .select("id")
      .gte("created_at", since);

    return {
      successRate: total > 0 ? Math.round((success / total) * 100) : 0,
      totalJobs: total,
      topFailures: failures,
      healCount: heals?.length ?? 0,
      avgDurationMin: Math.round(avgMs / 60000),
    };
  } catch {
    return { successRate: 0, totalJobs: 0, topFailures: [], healCount: 0, avgDurationMin: 0 };
  }
}

export async function writeWeeklyReport(data: Awaited<ReturnType<typeof gatherWeeklyData>>): Promise<string> {
  const { year, week } = getWeekNumber();
  const weekStr = String(week).padStart(2, "0");
  const path = resolve(LEARNINGS_DIR, `${year}-W${weekStr}-weekly-analysis.md`);

  const content = [
    `# Weekly Analysis — ${year} W${weekStr}`,
    "",
    `**Generated:** ${new Date().toISOString()}`,
    "",
    "## Job Performance",
    `- Success rate: ${data.successRate}%`,
    `- Total jobs: ${data.totalJobs}`,
    `- Avg duration: ${data.avgDurationMin}m`,
    `- Self-heals triggered: ${data.healCount}`,
    "",
    "## Top Failures",
    data.topFailures.length > 0
      ? data.topFailures.map((f) => `- ${f}`).join("\n")
      : "- None this week",
  ].join("\n");

  await Bun.write(path, content);
  logger.info("outcome-analysis:written", { path });
  return path;
}

export async function runOutcomeAnalysis(): Promise<void> {
  logger.info("outcome-analysis:run");
  const data = await gatherWeeklyData();
  await writeWeeklyReport(data);
}
