import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { runPrompt } from "../claude/run-prompt.ts";
import { STATE_DIR } from "../memory/brain-vault-paths.ts";
import { resolve } from "node:path";

const OUTPUT_PATH = resolve(STATE_DIR, "discoverability-report.md");

export async function runDiscoverabilityCheck(): Promise<void> {
  if (!config.DISCOVERABILITY_ENABLED) return;

  const { text, ok } = await runPrompt({
    system: `You are an AI-era discoverability expert. Generate a brief weekly checklist for a creative technologist to improve their discoverability in AI search, LLM context, and traditional SEO.
Include:
1. Content gaps to fill
2. AI citation optimization tips
3. Platform presence checks (LinkedIn, GitHub, personal site)
4. Specific action items for this week

Keep it actionable, under 400 words.`,
    prompt: `Generate discoverability checklist for week of ${new Date().toLocaleDateString()}. Focus on practical, implementable actions.`,
    model: "claude-haiku-4-5-20251001",
  });

  if (!ok || !text) return;

  const report = `# Discoverability Report\n_${new Date().toLocaleDateString()}_\n\n${text}`;
  await Bun.write(OUTPUT_PATH, report);
  logger.info("discoverability:report-written");
}
