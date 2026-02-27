import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { runPromptMulti } from "../llm/run-prompt-multi.ts";
import { logger } from "../utils/logger.ts";
import type { ModelId } from "../jobs/types.ts";

export type ComparisonResult = {
  taskType: string;
  promptPreview: string;
  scores: Partial<Record<ModelId, number>>;
  winner: ModelId;
  synthesisAddedValue: boolean;
  durations: Partial<Record<ModelId, number>>;
};

export async function storeComparison(result: ComparisonResult): Promise<void> {
  if (!memoryEnabled) return;

  try {
    const { error } = await getSupabase()
      .from("model_comparisons")
      .insert({
        task_type: result.taskType,
        prompt_preview: result.promptPreview.slice(0, 200),
        claude_score: result.scores.claude ?? null,
        codex_score: result.scores.codex ?? null,
        gemini_score: result.scores.gemini ?? null,
        kimi_score: result.scores.kimi ?? null,
        winner: result.winner,
        synthesis_added_value: result.synthesisAddedValue,
        claude_duration_ms: result.durations.claude ?? null,
        codex_duration_ms: result.durations.codex ?? null,
        gemini_duration_ms: result.durations.gemini ?? null,
        kimi_duration_ms: result.durations.kimi ?? null,
      });
    if (error)
      logger.warn("comparisons:insert-error", { error: error.message });
  } catch (err) {
    logger.warn("comparisons:store-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getWinRates(
  days = 30,
): Promise<Partial<Record<ModelId, number>>> {
  if (!memoryEnabled) return {};

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabase()
    .from("model_comparisons")
    .select("winner")
    .gte("created_at", since);

  if (error || !data) return {};

  const counts: Partial<Record<ModelId, number>> = {};
  const total = data.length;

  for (const row of data) {
    const model = row.winner as ModelId;
    counts[model] = (counts[model] ?? 0) + 1;
  }

  for (const model of Object.keys(counts) as ModelId[]) {
    counts[model] = Math.round((counts[model]! / total) * 100);
  }

  return counts;
}

export async function getTaskTypeWinners(
  days = 30,
): Promise<Array<{ taskType: string; winner: ModelId; count: number }>> {
  if (!memoryEnabled) return [];

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabase()
    .from("model_comparisons")
    .select("task_type, winner")
    .gte("created_at", since);

  if (error || !data) return [];

  const map = new Map<string, Map<ModelId, number>>();
  for (const row of data) {
    const tt = row.task_type as string;
    const w = row.winner as ModelId;
    if (!map.has(tt)) map.set(tt, new Map());
    map.get(tt)!.set(w, (map.get(tt)!.get(w) ?? 0) + 1);
  }

  const results: Array<{ taskType: string; winner: ModelId; count: number }> =
    [];
  for (const [taskType, winnerMap] of map) {
    const [winner, count] = [...winnerMap.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0]!;
    results.push({ taskType, winner, count });
  }

  return results.sort((a, b) => b.count - a.count);
}

export async function scoreOutputsAndStore(
  prompt: string,
  outputs: Array<{ model: ModelId; output: string; durationMs?: number }>,
  synthesisAddedValue: boolean,
): Promise<void> {
  if (outputs.length < 2) return;

  const scores: Partial<Record<ModelId, number>> = {};
  const durations: Partial<Record<ModelId, number>> = {};

  for (const o of outputs) {
    if (o.durationMs) durations[o.model] = o.durationMs;
    if (!o.output.trim()) {
      scores[o.model] = 1;
      continue;
    }

    try {
      const { text, ok } = await runPromptMulti({
        system:
          "Score this AI response 1-5 for quality, accuracy, and completeness. Reply with just the number.",
        prompt: `Task: ${prompt.slice(0, 200)}\n\nResponse: ${o.output.slice(-1500)}`,
        source: "comparisons",
      });
      if (!ok) {
        scores[o.model] = 3;
        continue;
      }
      const score = parseInt(text.trim(), 10);
      scores[o.model] = isNaN(score) ? 3 : Math.min(5, Math.max(1, score));
    } catch {
      scores[o.model] = 3;
    }
  }

  const winner =
    (Object.entries(scores) as Array<[ModelId, number]>).sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0] ?? "claude";

  await storeComparison({
    taskType: "general",
    promptPreview: prompt,
    scores,
    winner,
    synthesisAddedValue,
    durations,
  });
}
