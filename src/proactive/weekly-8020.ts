import type { Bot } from "gramio";
import { config } from "../config.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { runPrompt } from "../claude/run-prompt.ts";
import { STATE_DIR } from "../memory/brain-vault-paths.ts";
import { resolve } from "node:path";
import { logger } from "../utils/logger.ts";

type JobRow = {
  id: string;
  model: string | null;
  prompt: string | null;
  outcome_summary: string | null;
  duration_ms: number | null;
};

type ScoredJob = JobRow & { score: number };

function scoreJob(job: JobRow): number {
  let s = 0;
  if (job.duration_ms && job.duration_ms > 60_000) s += 2;
  else if (job.duration_ms && job.duration_ms > 30_000) s += 1;
  if (job.outcome_summary) s += 1;
  return s;
}

async function gatherWeeklyStats(weekAgoISO: string): Promise<string> {
  const sections: string[] = [];
  const sb = getSupabase();

  // 1. Routing accuracy — model distribution
  try {
    const { data: modelJobs } = await sb
      .from("jobs")
      .select("model")
      .gte("started_at", weekAgoISO)
      .eq("status", "completed");
    if (modelJobs && modelJobs.length > 0) {
      const counts = new Map<string, number>();
      for (const j of modelJobs) {
        const m = (j as { model: string | null }).model ?? "unknown";
        counts.set(m, (counts.get(m) ?? 0) + 1);
      }
      const total = modelJobs.length;
      const lines = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([m, c]) => `${m}: ${c} (${Math.round((c / total) * 100)}%)`);
      sections.push(`Model routing: ${lines.join(", ")}`);
    }
  } catch {}

  // 2. Input source distribution — namespace as proxy
  try {
    const { data: nsJobs } = await sb
      .from("jobs")
      .select("namespace")
      .gte("started_at", weekAgoISO)
      .eq("status", "completed");
    if (nsJobs && nsJobs.length > 0) {
      const counts = new Map<string, number>();
      for (const j of nsJobs) {
        const ns = (j as { namespace: string | null }).namespace ?? "telegram";
        counts.set(ns, (counts.get(ns) ?? 0) + 1);
      }
      const total = nsJobs.length;
      const lines = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([ns, c]) => `${ns}: ${c} (${Math.round((c / total) * 100)}%)`);
      sections.push(`Input sources: ${lines.join(", ")}`);
    }
  } catch {}

  // 3. Top 3 most-healed job types from self_heal_log
  try {
    const { data: heals } = await sb
      .from("self_heal_log")
      .select("source, name")
      .gte("created_at", weekAgoISO);
    if (heals && heals.length > 0) {
      const counts = new Map<string, number>();
      for (const h of heals) {
        const row = h as { source: string; name: string };
        const key = `${row.source}/${row.name}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const top3 = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, c]) => `${k} (${c}x)`);
      if (top3.length > 0) {
        sections.push(`Top healed: ${top3.join(", ")}`);
      }
    }
  } catch {}

  return sections.join("\n");
}

async function loadVision(): Promise<string> {
  const candidates = [resolve(STATE_DIR, "vision.md")];
  for (const p of candidates) {
    try {
      const text = await Bun.file(p).text();
      if (text.trim().length > 0) return text;
    } catch {}
  }
  return "";
}

export async function runWeekly8020(bot: Bot): Promise<void> {
  if (!memoryEnabled) {
    logger.warn("weekly-8020:skip", { reason: "memory not configured" });
    return;
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const { data: jobs, error } = await getSupabase()
    .from("jobs")
    .select("id, model, prompt, outcome_summary, duration_ms")
    .gte("started_at", weekAgo.toISOString())
    .eq("status", "completed")
    .order("started_at", { ascending: false });

  if (error || !jobs || jobs.length === 0) {
    logger.info("weekly-8020:no-jobs", { error: error?.message });
    return;
  }

  const scored: ScoredJob[] = (jobs as JobRow[])
    .map((j) => ({ ...j, score: scoreJob(j) }))
    .sort((a, b) => b.score - a.score);

  const topCount = Math.max(1, Math.ceil(scored.length * 0.2));
  const topJobs = scored.slice(0, topCount);

  const topSummary = topJobs
    .map(
      (j, i) =>
        `${i + 1}. [${j.model ?? "unknown"}] ${(j.prompt ?? "").slice(0, 120)} → ${(j.outcome_summary ?? "no summary").slice(0, 100)}`,
    )
    .join("\n");

  const narrativeResult = await runPrompt({
    system:
      "You are EDDIE's weekly analyst. Given the top 20% of jobs by impact, write 3-4 bullet points summarizing what was achieved. Be concise and specific.",
    prompt: `Total jobs: ${jobs.length}. Top ${topCount} by score:\n${topSummary}`,
    model: "claude-haiku-4-5-20251001",
    maxWaitMs: 30_000,
  });

  const narrative = narrativeResult.ok
    ? narrativeResult.text
    : `Top ${topCount} of ${jobs.length} jobs completed.`;

  const vision = await loadVision();
  let alignmentScore = "N/A";

  if (vision) {
    const alignResult = await runPrompt({
      system:
        "You are a vision alignment scorer. Given a vision document and a summary of this week's top work, rate 1-10 how well the work aligned with the vision. Reply ONLY with a single number 1-10.",
      prompt: `Vision:\n${vision.slice(0, 2000)}\n\nThis week's top work:\n${topSummary}`,
      model: "claude-haiku-4-5-20251001",
      maxWaitMs: 15_000,
    });
    if (alignResult.ok) {
      const match = alignResult.text.match(/\b(\d{1,2})\b/);
      if (match) alignmentScore = match[1]!;
    }
  }

  const statsBlock = await gatherWeeklyStats(weekAgo.toISOString());

  const message = [
    "\u{1f4ca} Weekly 80/20",
    "",
    narrative,
    "",
    `Vision alignment: ${alignmentScore}/10`,
    `(${jobs.length} total jobs, top ${topCount} analyzed)`,
    ...(statsBlock ? ["", statsBlock] : []),
  ].join("\n");

  await bot.api.sendMessage({
    chat_id: config.OWNER_TELEGRAM_ID,
    text: message,
  });

  const dateStr = now.toISOString().slice(0, 10);
  const reportPath = resolve(STATE_DIR, `weekly-8020-${dateStr}.md`);
  const report = [
    `# Weekly 80/20 Review — ${dateStr}`,
    "",
    `Total completed jobs: ${jobs.length}`,
    `Top 20% count: ${topCount}`,
    `Vision alignment: ${alignmentScore}/10`,
    "",
    "## Top Jobs",
    topSummary,
    "",
    "## Narrative",
    narrative,
    ...(statsBlock ? ["", "## Stats", statsBlock] : []),
  ].join("\n");

  try {
    await Bun.write(reportPath, report);
    logger.info("weekly-8020:saved", { path: reportPath });
  } catch (err) {
    logger.warn("weekly-8020:save-error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info("weekly-8020:sent", {
    jobs: jobs.length,
    top: topCount,
    alignmentScore,
  });
}
