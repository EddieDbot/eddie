import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { storeFact } from "../memory/store.ts";
import { searchMemory } from "../memory/search.ts";
import { logger } from "../utils/logger.ts";

export async function gatherHealPatterns(): Promise<{
  total: number;
  resolved: number;
  bySource: Array<{ source: string; total: number; resolved: number }>;
}> {
  if (!memoryEnabled) return { total: 0, resolved: 0, bySource: [] };
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data } = await getSupabase()
      .from("self_heal_log")
      .select("source, resolved")
      .gte("created_at", since);
    if (!data) return { total: 0, resolved: 0, bySource: [] };

    const map = new Map<string, { total: number; resolved: number }>();
    for (const row of data) {
      const src = (row.source as string) ?? "unknown";
      if (!map.has(src)) map.set(src, { total: 0, resolved: 0 });
      const entry = map.get(src)!;
      entry.total++;
      if (row.resolved) entry.resolved++;
    }

    const bySource = Array.from(map.entries()).map(([source, stats]) => ({
      source,
      ...stats,
    }));
    const total = bySource.reduce((s, r) => s + r.total, 0);
    const resolved = bySource.reduce((s, r) => s + r.resolved, 0);
    return { total, resolved, bySource };
  } catch {
    return { total: 0, resolved: 0, bySource: [] };
  }
}

export async function extractRejectionLearnings(): Promise<void> {
  if (!memoryEnabled) return;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data } = await getSupabase()
      .from("human_judgments")
      .select("feedback, prompt_preview")
      .eq("judgment", "rejected")
      .not("feedback", "is", null)
      .gte("created_at", since);
    if (!data || data.length === 0) return;

    for (const row of data) {
      const feedback = (row.feedback as string).trim();
      if (!feedback || feedback.length < 10) continue;
      const insight = `User rejected: ${(row.prompt_preview as string ?? "").slice(0, 80)} — reason: ${feedback.slice(0, 120)}`;
      const existing = await searchMemory(insight, 3, 0.85).catch(() => []);
      if (existing.length === 0) {
        await storeFact(insight, "learning", "rejection-analysis");
        logger.debug("self-improve:rejection-stored", {
          insight: insight.slice(0, 60),
        });
      }
    }
  } catch (err) {
    logger.warn("self-improve:rejection-error", { error: String(err) });
  }
}

export async function runWeeklyAnalysis(): Promise<void> {
  const { gatherWeeklyData, writeWeeklyReport } = await import(
    "./outcome-analysis.ts"
  );
  const { getWinRates, getTaskTypeWinners } = await import(
    "../routing/comparisons.ts"
  );

  const [weeklyData, winRates, taskWinners, healPatterns] = await Promise.all([
    gatherWeeklyData(),
    getWinRates(30),
    getTaskTypeWinners(30),
    gatherHealPatterns(),
  ]);

  const extras = { winRates, taskWinners, healPatterns };
  await writeWeeklyReport(weeklyData, extras);

  const summary = `Weekly: ${weeklyData.successRate}% success (${weeklyData.totalJobs} jobs), ${weeklyData.healCount} heals. Top model: ${Object.entries(winRates).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "none"}.`;
  await storeFact(summary, "learning", "weekly-analysis").catch(() => {});

  logger.info("self-improve:weekly-done");
}
