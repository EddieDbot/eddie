import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { runPrompt } from "../claude/run-prompt.ts";

type ObservationInput = {
  source: string;
  mediaType: "photo" | "video" | "audio" | "text" | "screen";
  filePath?: string;
  textContent?: string;
};

type ClassificationResult = {
  classification: string;
  labels: string[];
  description: string;
  patterns: string[];
};

export async function logObservation(input: ObservationInput): Promise<void> {
  if (!config.OBSERVATION_LOG_ENABLED || !memoryEnabled) return;

  let classification = "unknown";
  let labels: string[] = [];
  let description = "";
  let patterns: string[] = [];

  if (input.mediaType === "text" && input.textContent) {
    const { text, ok } = await runPrompt({
      system:
        "Classify this observation. Return JSON: {classification: string, labels: string[], description: string, patterns: string[]}",
      prompt: input.textContent.slice(0, 1000),
      model: "claude-haiku-4-5-20251001",
    });

    if (ok && text) {
      try {
        const match = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
        const parsed = JSON.parse(match) as Partial<ClassificationResult>;
        classification = parsed.classification ?? "text-observation";
        labels = parsed.labels ?? [];
        description = parsed.description ?? "";
        patterns = parsed.patterns ?? [];
      } catch {}
    }
  }

  const { error } = await getSupabase()
    .from("observations")
    .insert({
      source: input.source,
      media_type: input.mediaType,
      classification,
      labels,
      description,
      patterns,
      file_path: input.filePath,
    });

  if (error) {
    logger.warn("observation-log:save-error", { error: error.message });
  } else {
    logger.info("observation-log:saved", {
      source: input.source,
      classification,
    });
  }
}

export async function getRecentPatterns(days = 7): Promise<string[]> {
  if (!memoryEnabled) return [];

  const since = new Date(
    Date.now() - days * 24 * 3600 * 1000,
  ).toISOString();

  const { data } = await getSupabase()
    .from("observations")
    .select("patterns")
    .gte("observed_at", since);

  if (!data) return [];

  const allPatterns = data.flatMap(
    (r) => (r.patterns as string[] | null) ?? [],
  );
  const counts = new Map<string, number>();
  for (const p of allPatterns) {
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([pattern]) => pattern);
}
