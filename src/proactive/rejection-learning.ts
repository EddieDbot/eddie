import type { Bot } from "gramio";
import { config } from "../config.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { runPrompt } from "../claude/run-prompt.ts";
import { logger } from "../utils/logger.ts";

const MIN_OFF_RATINGS = 5;
const HIGH_OFF_RATE_THRESHOLD = 0.25;

type FeedbackRow = { job_id: string; rating: string; reason: string | null };
type JobRow = { id: string; model: string; prompt: string };

export async function runRejectionLearning(bot: Bot): Promise<void> {
  if (!memoryEnabled) {
    logger.info("rejection-learning:skipped", { reason: "supabase not configured" });
    return;
  }

  const sb = getSupabase();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch off-rated feedback from the last 7 days
  const { data: allFeedback, error: fbErr } = await sb
    .from("job_feedback")
    .select("job_id, rating, reason")
    .gte("created_at", weekAgo);

  if (fbErr) {
    logger.warn("rejection-learning:feedback-query-failed", { error: fbErr.message });
    return;
  }
  if (!allFeedback || allFeedback.length === 0) {
    logger.info("rejection-learning:no-feedback");
    return;
  }

  const feedback = allFeedback as FeedbackRow[];
  const offFeedback = feedback.filter((f) => f.rating === "off");

  if (offFeedback.length < MIN_OFF_RATINGS) {
    logger.info("rejection-learning:insufficient-signal", {
      offCount: offFeedback.length,
      min: MIN_OFF_RATINGS,
    });
    return;
  }

  // Get matching job info for the off-rated jobs
  const offJobIds = [...new Set(offFeedback.map((f) => f.job_id))];
  const { data: jobsData, error: jobErr } = await sb
    .from("jobs")
    .select("id, model, prompt")
    .in("id", offJobIds);

  if (jobErr) {
    logger.warn("rejection-learning:jobs-query-failed", { error: jobErr.message });
    return;
  }

  const jobs = (jobsData ?? []) as JobRow[];
  const jobMap = new Map(jobs.map((j) => [j.id, j]));

  // Group feedback by model, compute off-rate per model
  const modelStats = new Map<string, { total: number; off: number }>();
  for (const fb of feedback) {
    const job = jobMap.get(fb.job_id);
    const model = job?.model ?? "unknown";
    const entry = modelStats.get(model) ?? { total: 0, off: 0 };
    entry.total++;
    if (fb.rating === "off") entry.off++;
    modelStats.set(model, entry);
  }

  // Identify high off-rate models
  const flagged: string[] = [];
  for (const [model, stats] of modelStats) {
    if (stats.total > 0 && stats.off / stats.total > HIGH_OFF_RATE_THRESHOLD) {
      flagged.push(`- ${model}: ${stats.off}/${stats.total} (${Math.round((stats.off / stats.total) * 100)}%)`);
    }
  }

  // Collect reasons for LLM analysis
  const reasons = offFeedback
    .map((f) => f.reason)
    .filter((r): r is string => !!r && r.trim().length > 0);

  let patternsText = "No rejection reasons recorded — encourage feedback with reasons.";

  if (reasons.length >= 2) {
    const { text, ok } = await runPrompt({
      system: "You analyze job rejection feedback to find patterns. Be concise.",
      prompt: `These are reasons users gave for rating jobs as "off" (bad):\n\n${reasons.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\nWhat common patterns explain why these jobs were rated off? Give exactly 3 bullet points, each starting with "•".`,
      model: "claude-haiku-4-5-20251001",
      maxWaitMs: 25_000,
    });

    if (ok && text.trim()) {
      patternsText = text.trim();
    }
  }

  const message = [
    "Rejection Learning Report",
    "",
    flagged.length > 0
      ? `High-off-rate job types (>${Math.round(HIGH_OFF_RATE_THRESHOLD * 100)}%):\n${flagged.join("\n")}`
      : "No job types exceed the off-rate threshold.",
    "",
    `Total off ratings this week: ${offFeedback.length}/${feedback.length}`,
    "",
    "Patterns:",
    patternsText,
  ].join("\n");

  try {
    await bot.api.sendMessage({
      chat_id: config.OWNER_TELEGRAM_ID,
      text: message,
    });
    logger.info("rejection-learning:sent", { offCount: offFeedback.length });
  } catch (err) {
    logger.warn("rejection-learning:send-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
