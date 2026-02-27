import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { runPromptMulti } from "../llm/run-prompt-multi.ts";

export async function generateVideoIdeas(
  topic: string,
  count = 3,
): Promise<string[]> {
  const { text, ok } = await runPromptMulti({
    system: `You are a video strategy expert for a creative technologist. Generate ${count} specific YouTube video ideas for the given topic. Each idea should have:
- A hook-first title (not clickbait, genuine value)
- Target audience
- Key insight/angle that makes it unique
Format: numbered list, one per line`,
    prompt: `Topic: ${topic}`,
    source: "video-idea-pipeline",
  });

  if (!ok || !text) return [];
  return text
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, count);
}

export async function saveVideoIdea(params: {
  title: string;
  hook?: string;
  format?: string;
  targetAudience?: string;
  source?: string;
  sourceUrl?: string;
}): Promise<string | null> {
  if (!memoryEnabled) return null;

  const { data, error } = await getSupabase()
    .from("video_ideas")
    .insert({
      title: params.title,
      hook: params.hook,
      format: params.format,
      target_audience: params.targetAudience,
      source: params.source,
      source_url: params.sourceUrl,
    })
    .select("id")
    .single();

  if (error) {
    logger.warn("video-pipeline:save-error", { error: error.message });
    return null;
  }
  return data?.id ?? null;
}

export async function listVideoIdeas(
  status = "idea",
): Promise<Array<Record<string, unknown>>> {
  if (!memoryEnabled) return [];
  const { data } = await getSupabase()
    .from("video_ideas")
    .select("id, title, hook, format, status, created_at")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(10);
  return data ?? [];
}
