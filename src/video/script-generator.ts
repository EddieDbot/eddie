import { runPrompt, parseJsonFromOutput } from "../claude/run-prompt.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";
import type { VideoStory } from "./news-gatherer.ts";

export type ScriptSection = {
  text: string;
  durationSec: number;
  visual: string;
};

export type VideoScript = {
  hook: string;
  sections: ScriptSection[];
  cta: string;
  totalDurationSec: number;
  title: string;
  description: string;
  tags: string[];
};

const SYSTEM_PROMPT = `You are a scriptwriter for an AI-focused YouTube Shorts channel. Write punchy, engaging scripts that hook viewers in the first 3 seconds. Style: direct, energetic, informative. No fluff. Tech-savvy audience.

Output ONLY valid JSON matching this schema:
{
  "hook": "Opening line (max 15 words, must grab attention immediately)",
  "sections": [
    { "text": "narration text", "durationSec": number, "visual": "brief description of what should be shown on screen" }
  ],
  "cta": "Closing call to action (max 10 words)",
  "totalDurationSec": number,
  "title": "YouTube video title (SEO-optimized, max 60 chars)",
  "description": "YouTube description (2-3 sentences + relevant hashtags)",
  "tags": ["tag1", "tag2", "..."]
}

Target total duration: 60-75 seconds. 3-5 sections. Each section 10-20 seconds.`;

export async function generateNewsShortScript(story: VideoStory): Promise<VideoScript | null> {
  const prompt = `Write a YouTube Shorts script about this AI news story:

Headline: ${story.headline}
Source: ${story.source}
${story.summary ? `Summary: ${story.summary}` : ""}
${story.publishedAt ? `Published: ${story.publishedAt}` : ""}

Generate a 60-75 second script following the JSON schema exactly.`;

  const result = await runPrompt({
    prompt,
    system: SYSTEM_PROMPT,
    model: "claude-sonnet-4-6",
    maxWaitMs: 60_000,
  });

  if (!result.ok || !result.text) {
    logger.error("script-generator:llm-failed", { storyId: story.id, headline: story.headline });
    return null;
  }

  const script = parseJsonFromOutput<VideoScript | null>(result.text, null);

  if (!script || !script.hook || !Array.isArray(script.sections) || script.sections.length === 0) {
    logger.error("script-generator:parse-failed", { storyId: story.id, raw: result.text.slice(0, 200) });
    return null;
  }

  logger.info("script-generator:done", {
    storyId: story.id,
    title: script.title,
    totalDurationSec: script.totalDurationSec,
    sections: script.sections.length,
  });

  return script;
}

export async function saveScript(renderId: string, script: VideoScript): Promise<void> {
  if (!memoryEnabled) {
    logger.warn("script-generator:save-skipped", { reason: "supabase not configured" });
    return;
  }

  const { error } = await getSupabase()
    .from("video_renders")
    .update({ script: JSON.stringify(script) })
    .eq("id", renderId);

  if (error) {
    logger.error("script-generator:save-error", { renderId, error: error.message });
  }
}
