import { runPrompt, parseJsonFromOutput } from "../claude/run-prompt.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";
import type { VideoStory } from "./news-gatherer.ts";

export type VideoScript = {
  emotionTarget: "LOL" | "WTF" | "OMG" | "Wow" | "Finally";
  node: string;
  hook: string;
  foreshadow: string;
  body: string[];
  payoff: string;
  estimatedRuntimeSec: number;
  title: string;
  description: string;
  tags: string[];
};

const SYSTEM_PROMPT = `You are EddieDbot's script writer. EddieDbot is a faceless AI content channel on YouTube Shorts — no human face, AI-generated motion graphics, ElevenLabs voice narration.

STRUCTURE (mandatory, every script):
Output four labeled sections:
[HOOK] — 2 sentences max. State the premise AND the tension. Do NOT reveal the twist or main reveal.
[FORESHADOW] — 1 sentence. Tell the viewer what they're waiting for, without giving it away. Use a numbered mechanism ("3 things") or a named promise ("here's what actually happened").
[BODY] — 3-5 sentences. Every transition must use "but" (reversal) or "therefore" (consequence) — never "and then." Each sentence does one job: build tension, answer a question, or raise a new question. Include one rehook mid-body ("but here's what nobody's talking about").
[PAYOFF] — 1 sentence. Short. Definitive. The twist or reveal. Written as the last thing said. 10 words or fewer preferred.

HOOK RULES:
- Hook must work without audio — the first frame of motion graphics must communicate the setup visually
- Hook must work as a long-form title and still get clicks
- Lead with consequence, not conclusion: "This AI model just made an $800 billion industry nervous." not "A new AI model was released."
- Use one of these formulas: Promise ("X happened. But Y changes everything."), Consequence ("X is doing Y. Here's what that costs you."), Common Enemy ("Big Tech won't say this. We will."), Social Proof ("After testing 200 AI tools, here's what survived.")

NODE REQUIREMENT (mandatory):
Every script must include one piece of information, analysis, or framing that is specific to EddieDbot and not available from reading the raw news item. This is your "node" — the thing that moves this video outside the algorithmic conflict radius of other AI news channels. The node must be explicitly identifiable: a specific comparison, a data point with context, a named consequence, a prediction with a rationale. If you cannot identify the node, request more source material before generating.

LENGTH:
Target 10–15 seconds when read aloud at normal pace. This is extremely short. You get: 1-2 sentence hook, 1-2 body sentences, 1 payoff. Every word must earn its place. Cut anything that doesn't add tension or payoff. If under 10 seconds, that's fine — never pad.

LANGUAGE:
- 5th grade readability or below. Use readabilityformulas.com as reference.
- No jargon without immediate definition. "LLM" → "AI language model" on first use.
- No idioms that won't translate globally. No "not their first rodeo."
- No pacing killers: never start with "In this video," "Welcome back," or "Let's get started."
- No CTA in the script. CTAs are added post-production in a separate layer.

EMOTION TARGET:
Before generating the script, state the target emotional reaction in brackets: [LOL] / [WTF] / [OMG] / [Wow] / [Finally/I agree]. Every line in the body must build toward that reaction. Cut lines that don't.

TRANSITIONS:
- "But" for reversals
- "Therefore" for consequences
- "Turns out" before the reveal (use once, at the end)
- Never "and then"

ENDING:
Cut immediately after [PAYOFF]. No outro. The ending should make a viewer want to rewatch from the beginning. Ambiguity is acceptable if it drives comment engagement — but clarity is safer.

OUTPUT FORMAT (respond ONLY with valid JSON, no markdown fences):
{
  "emotionTarget": "LOL|WTF|OMG|Wow|Finally",
  "node": "1 sentence describing the specific original information/analysis this video adds",
  "hook": "2 sentences — premise + tension",
  "foreshadow": "1 sentence — mechanism or promise",
  "body": ["sentence 1", "sentence 2", "sentence 3"],
  "payoff": "final line, ≤10 words",
  "estimatedRuntimeSec": 30,
  "title": "YouTube video title (SEO-optimized, max 60 chars)",
  "description": "YouTube description (2-3 sentences + relevant hashtags)",
  "tags": ["tag1", "tag2"]
}`;

export async function generateNewsShortScript(
  story: VideoStory,
): Promise<VideoScript | null> {
  const prompt = `Write a YouTube Shorts script about this AI news story:

Headline: ${story.headline}
Source: ${story.source}
${story.summary ? `Summary: ${story.summary}` : ""}
${story.publishedAt ? `Published: ${story.publishedAt}` : ""}

Generate a 10-15 second script following the JSON schema exactly. Output ONLY valid JSON.`;

  const result = await runPrompt({
    prompt,
    system: SYSTEM_PROMPT,
    model: "claude-sonnet-4-6",
    maxWaitMs: 120_000,
  });

  if (!result.ok || !result.text) {
    logger.error("script-generator:llm-failed", {
      storyId: story.id,
      headline: story.headline,
    });
    return null;
  }

  const script = parseJsonFromOutput<VideoScript | null>(result.text, null);

  if (
    !script ||
    !script.hook ||
    !script.foreshadow ||
    !Array.isArray(script.body) ||
    script.body.length === 0 ||
    !script.payoff
  ) {
    logger.error("script-generator:parse-failed", {
      storyId: story.id,
      raw: result.text.slice(0, 200),
    });
    return null;
  }

  logger.info("script-generator:done", {
    storyId: story.id,
    title: script.title,
    estimatedRuntimeSec: script.estimatedRuntimeSec,
    emotionTarget: script.emotionTarget,
    bodyCount: script.body.length,
  });

  return script;
}

export async function regenerateScript(
  previousScript: VideoScript,
  qaIssues: string[],
): Promise<VideoScript | null> {
  const prompt = `The previous script failed QA. Revise it based on the following issues:

PREVIOUS SCRIPT:
Hook: ${previousScript.hook}
Foreshadow: ${previousScript.foreshadow}
Body: ${previousScript.body.join(" ")}
Payoff: ${previousScript.payoff}
Emotion target: ${previousScript.emotionTarget}

QA ISSUES TO FIX:
${qaIssues.map((issue, i) => `${i + 1}. ${issue}`).join("\n")}

Generate a revised script that fixes all issues. Keep the same story angle and node. Output ONLY valid JSON matching the same schema.`;

  const result = await runPrompt({
    prompt,
    system: SYSTEM_PROMPT,
    model: "claude-sonnet-4-6",
    maxWaitMs: 120_000,
  });

  if (!result.ok || !result.text) {
    logger.error("script-generator:regenerate-failed");
    return null;
  }

  const script = parseJsonFromOutput<VideoScript | null>(result.text, null);

  if (
    !script ||
    !script.hook ||
    !script.foreshadow ||
    !Array.isArray(script.body) ||
    script.body.length === 0 ||
    !script.payoff
  ) {
    logger.error("script-generator:regenerate-parse-failed", {
      raw: result.text.slice(0, 200),
    });
    return null;
  }

  logger.info("script-generator:regenerated", {
    title: script.title,
    estimatedRuntimeSec: script.estimatedRuntimeSec,
  });

  return script;
}

export async function saveScript(
  renderId: string,
  script: VideoScript,
): Promise<void> {
  if (!memoryEnabled) {
    logger.warn("script-generator:save-skipped", {
      reason: "supabase not configured",
    });
    return;
  }

  const { error } = await getSupabase()
    .from("video_renders")
    .update({ script: JSON.stringify(script) })
    .eq("id", renderId);

  if (error) {
    logger.error("script-generator:save-error", {
      renderId,
      error: error.message,
    });
  }
}
