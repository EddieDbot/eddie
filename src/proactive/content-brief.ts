import { runPromptMulti } from "../llm/run-prompt-multi.ts";
import { logger } from "../utils/logger.ts";
import { mkdir } from "node:fs/promises";
import { BRAIN_VAULT_ROOT } from "../memory/brain-vault-paths.ts";

export async function generateContentBrief(
  topic: string,
  voiceNote?: string,
): Promise<string> {
  const isBrainDump = topic.length > 100;

  // For brain dumps, extract a search query from the first sentence rather than using the full text
  const searchQuery = isBrainDump
    ? (topic.split(/[.!?\n]/)[0]?.slice(0, 80) ?? topic.slice(0, 80))
    : topic;

  const contextParts = isBrainDump
    ? [`Brain dump / voice note:\n${topic}`]
    : [`Topic: ${topic}`];
  if (voiceNote && !isBrainDump)
    contextParts.push(`Voice note context: ${voiceNote}`);
  const prompt = contextParts.join("\n\n");

  const systemInstruction = isBrainDump
    ? `You are a creative content strategist for Nicholas, a creative technologist and director.
The user has sent a brain dump / voice note with multiple ideas. Extract the strongest content angle and generate a structured brief:
**Core Idea** (distill the brain dump into one punchy thesis)
**Hook Options** (2-3 hooks)
**Angle** (the unique POV)
**Key Points** (3-5 bullets)
**Format Suggestions** (short-form, long-form, thread, etc.)
**Call to Action**

Be punchy, specific, and actionable. Avoid generic advice.`
    : `You are a creative content strategist for Nicholas, a creative technologist and director.
Generate a structured content brief with these sections:
**Hook Options** (2-3 hooks)
**Angle** (the unique POV)
**Key Points** (3-5 bullets)
**Format Suggestions** (short-form, long-form, thread, etc.)
**Call to Action**

Be punchy, specific, and actionable. Avoid generic advice.`;

  const userPrompt = isBrainDump
    ? `Structure this brain dump into a content brief:\n\n${prompt}`
    : `Create a content brief for: ${prompt}`;

  try {
    const { text: briefText, ok } = await runPromptMulti({
      provider: "gemini",
      system: systemInstruction,
      prompt: userPrompt,
      source: "content-brief",
    });
    if (!ok) return "Could not generate brief.";

    // Write to Brain Vault
    const date = new Date().toISOString().slice(0, 10);
    const slugSource = isBrainDump ? searchQuery : topic;
    const slug = slugSource
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40);
    const briefDir = `${BRAIN_VAULT_ROOT}/20 - Areas/Content/briefs`;
    const briefPath = `${briefDir}/${date}-${slug}.md`;

    try {
      await mkdir(briefDir, { recursive: true });
      await Bun.write(
        briefPath,
        `# Content Brief: ${topic}\n\n*Generated: ${date}*\n\n${briefText}\n`,
      );
      logger.info("content-brief:saved", { path: briefPath });
    } catch (writeErr) {
      logger.warn("content-brief:save-failed", {
        error: writeErr instanceof Error ? writeErr.message : String(writeErr),
      });
    }

    return briefText;
  } catch (err) {
    logger.error("content-brief:error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "Failed to generate content brief.";
  }
}
