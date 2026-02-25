import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";
import { LEARNINGS_DIR } from "../memory/brain-vault-paths.ts";

function getWeekNumber(): { year: number; week: number } {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(
    ((now.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7,
  );
  return { year: now.getFullYear(), week };
}

const STOPWORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "been",
  "will",
  "would",
  "could",
  "should",
  "their",
  "there",
  "these",
  "those",
  "about",
  "which",
  "after",
  "before",
  "other",
  "first",
  "also",
  "into",
  "just",
  "than",
  "then",
  "some",
  "when",
  "what",
  "your",
  "them",
  "each",
  "make",
  "like",
  "does",
  "were",
  "being",
  "more",
  "very",
  "most",
  "only",
  "over",
  "such",
  "here",
  "where",
  "while",
  "error",
  "failed",
  "completed",
  "eddie",
  "please",
  "using",
]);

function extractTopThemes(texts: string[], count = 5): string[] {
  const freq: Record<string, number> = {};
  for (const text of texts) {
    const words = text.toLowerCase().match(/[a-z]{5,}/g) ?? [];
    const seen = new Set<string>();
    for (const w of words) {
      if (STOPWORDS.has(w) || seen.has(w)) continue;
      seen.add(w);
      freq[w] = (freq[w] ?? 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, count)
    .map(([word]) => word);
}

export async function gatherWeeklyData(): Promise<{
  successRate: number;
  totalJobs: number;
  topFailures: string[];
  healCount: number;
  avgDurationMin: number;
  routingDistribution: Record<string, number>;
  volumeDelta: number;
  topThemes: string[];
}> {
  const empty = {
    successRate: 0,
    totalJobs: 0,
    topFailures: [] as string[],
    healCount: 0,
    avgDurationMin: 0,
    routingDistribution: {} as Record<string, number>,
    volumeDelta: 0,
    topThemes: [] as string[],
  };

  if (!memoryEnabled) return empty;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sincePrev = new Date(
    Date.now() - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();

  try {
    const { data: jobs } = await getSupabase()
      .from("jobs")
      .select("outcome, duration_ms, error, outcome_summary, model, prompt")
      .gte("started_at", since)
      .eq("status", "completed");

    const total = jobs?.length ?? 0;
    const success = jobs?.filter((j) => j.outcome === "success").length ?? 0;
    const failures =
      jobs
        ?.filter((j) => j.outcome === "failed")
        .map((j) => (j.outcome_summary || j.error || "unknown").slice(0, 80))
        .slice(0, 5) ?? [];

    const durations =
      jobs?.filter((j) => j.duration_ms).map((j) => j.duration_ms as number) ??
      [];
    const avgMs =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;

    const { data: heals } = await getSupabase()
      .from("self_heal_log")
      .select("id")
      .gte("created_at", since);

    // Routing distribution: count jobs per model
    const routingDistribution: Record<string, number> = {};
    for (const j of jobs ?? []) {
      const model = j.model || "unknown";
      routingDistribution[model] = (routingDistribution[model] ?? 0) + 1;
    }

    // Volume delta: compare this week vs prior week
    const { data: prevJobs } = await getSupabase()
      .from("jobs")
      .select("id")
      .gte("started_at", sincePrev)
      .lt("started_at", since)
      .eq("status", "completed");

    const prevCount = prevJobs?.length ?? 0;
    const volumeDelta =
      prevCount > 0 ? Math.round((total / prevCount) * 100 - 100) : 0;

    // Top themes from job prompts/summaries
    const texts = (jobs ?? [])
      .map((j) => `${j.prompt ?? ""} ${j.outcome_summary ?? ""}`)
      .filter((t) => t.trim().length > 0);
    const topThemes = extractTopThemes(texts);

    return {
      successRate: total > 0 ? Math.round((success / total) * 100) : 0,
      totalJobs: total,
      topFailures: failures,
      healCount: heals?.length ?? 0,
      avgDurationMin: Math.round(avgMs / 60000),
      routingDistribution,
      volumeDelta,
      topThemes,
    };
  } catch {
    return empty;
  }
}

export async function writeWeeklyReport(
  data: Awaited<ReturnType<typeof gatherWeeklyData>>,
  extras?: {
    winRates?: Partial<Record<string, number>>;
    taskWinners?: Array<{ taskType: string; winner: string; count: number }>;
    healPatterns?: {
      total: number;
      resolved: number;
      bySource: Array<{ source: string; total: number; resolved: number }>;
    };
  },
): Promise<string> {
  const { year, week } = getWeekNumber();
  const weekStr = String(week).padStart(2, "0");
  const path = resolve(LEARNINGS_DIR, `${year}-W${weekStr}-weekly-analysis.md`);

  const lines = [
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
    "",
    "## Routing Distribution",
    ...(Object.keys(data.routingDistribution).length > 0
      ? Object.entries(data.routingDistribution)
          .sort(([, a], [, b]) => b - a)
          .map(([model, count]) => `- ${model}: ${count} jobs`)
      : ["- No routing data"]),
    "",
    `## Volume Delta: ${data.volumeDelta >= 0 ? "+" : ""}${data.volumeDelta}% vs prior week`,
    "",
    "## Top Themes",
    ...(data.topThemes.length > 0
      ? data.topThemes.map((t) => `- ${t}`)
      : ["- No themes detected"]),
    ...(extras?.winRates && Object.keys(extras.winRates).length > 0
      ? [
          "",
          "## Model Win Rates (30d)",
          ...Object.entries(extras.winRates)
            .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
            .map(([m, r]) => `- ${m}: ${r}%`),
        ]
      : []),
    ...(extras?.taskWinners && extras.taskWinners.length > 0
      ? [
          "",
          "## Task Type Winners",
          ...extras.taskWinners
            .slice(0, 5)
            .map((w) => `- ${w.taskType}: ${w.winner} (${w.count}x)`),
        ]
      : []),
    ...(extras?.healPatterns && extras.healPatterns.total > 0
      ? [
          "",
          "## Heal Effectiveness",
          `- Total heals: ${extras.healPatterns.total}`,
          `- Resolved: ${extras.healPatterns.resolved}/${extras.healPatterns.total}`,
          ...extras.healPatterns.bySource.map(
            (b) => `- ${b.source}: ${b.resolved}/${b.total}`,
          ),
        ]
      : []),
  ];

  const content = lines.join("\n");

  await Bun.write(path, content);
  logger.info("outcome-analysis:written", { path });
  return path;
}

export async function runOutcomeAnalysis(): Promise<void> {
  logger.info("outcome-analysis:run");
  const data = await gatherWeeklyData();
  await writeWeeklyReport(data);
}
