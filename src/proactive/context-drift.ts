import type { Bot } from "gramio";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

export async function checkContextDrift(bot: Bot): Promise<void> {
  if (!memoryEnabled) return;

  const supabase = getSupabase();
  const minSample = config.CONTEXT_DRIFT_MIN_SAMPLE;
  const threshold = config.CONTEXT_DRIFT_THRESHOLD;

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("system_prompt_hash, status, duration_ms")
    .not("system_prompt_hash", "is", null)
    .in("status", ["completed", "failed"])
    .order("created_at", { ascending: false })
    .limit(200);

  if (error || !jobs?.length) return;

  const byHash = new Map<
    string,
    { total: number; succeeded: number; durationMs: number[] }
  >();
  for (const job of jobs) {
    const hash = job.system_prompt_hash as string;
    if (!byHash.has(hash))
      byHash.set(hash, { total: 0, succeeded: 0, durationMs: [] });
    const entry = byHash.get(hash)!;
    entry.total++;
    if (job.status === "completed") entry.succeeded++;
    if (job.duration_ms) entry.durationMs.push(job.duration_ms as number);
  }

  for (const [hash, stats] of byHash) {
    if (stats.total < minSample) continue;
    const successRate = stats.succeeded / stats.total;
    const avgDurationMs = stats.durationMs.length
      ? stats.durationMs.reduce((a, b) => a + b, 0) / stats.durationMs.length
      : null;

    const { data: baseline } = await supabase
      .from("context_drift_baselines")
      .select("success_rate, sample_count")
      .eq("system_prompt_hash", hash)
      .single();

    if (baseline && (baseline.sample_count as number) >= minSample) {
      const drop = (baseline.success_rate as number) - successRate;
      if (drop > threshold) {
        const msg = `⚠️ Context drift detected: hash ${hash.slice(0, 8)}... success rate dropped ${(drop * 100).toFixed(1)}% (${((baseline.success_rate as number) * 100).toFixed(1)}% → ${(successRate * 100).toFixed(1)}%) over ${stats.total} jobs`;
        logger.warn("context-drift:alert", {
          hash,
          drop,
          successRate,
          baseline: baseline.success_rate,
        });
        bot.api
          .sendMessage({ chat_id: config.OWNER_TELEGRAM_ID, text: msg })
          .catch(() => {});
      }
    }

    await supabase.from("context_drift_baselines").upsert(
      {
        system_prompt_hash: hash,
        sample_count: stats.total,
        success_rate: successRate,
        avg_duration_ms: avgDurationMs,
        last_updated_at: new Date().toISOString(),
      },
      { onConflict: "system_prompt_hash" },
    );
  }
}
