import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

export async function generateContentBrief(topic: string, voiceNote?: string): Promise<string> {
  if (!config.ANTHROPIC_API_KEY) return "API key not configured.";

  const prompt = voiceNote
    ? `Topic: ${topic}\nVoice note context: ${voiceNote}`
    : `Topic: ${topic}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": config.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: "You are a creative content strategist. Generate a concise content brief (3-5 bullet points: hook, key message, format, call to action, platform notes). Be punchy and actionable.",
        messages: [{ role: "user", content: `Create a content brief for: ${prompt}` }],
      }),
    });
    const data = (await res.json()) as { content: Array<{ text: string }> };
    return data.content?.[0]?.text ?? "Could not generate brief.";
  } catch (err) {
    logger.error("content-brief:error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "Failed to generate content brief.";
  }
}
