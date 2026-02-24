import { logger } from "../utils/logger.ts";
import { runPrompt } from "../claude/run-prompt.ts";
import { STATE_DIR, EDDIE_STATE_FILE } from "../memory/brain-vault-paths.ts";
import { resolve } from "node:path";

const DASHBOARD_OUTPUT = resolve(STATE_DIR, "eddie-dashboard.md");

export async function generateDashboard(): Promise<string> {
  let state = "";
  try {
    state = await Bun.file(EDDIE_STATE_FILE).text();
  } catch {}

  const { text, ok } = await runPrompt({
    system: `You are EDDIE's dashboard generator. Given the current system state, generate a concise, scannable markdown dashboard with:
1. **Status** — system health + active jobs count
2. **Today's focus** — top 3 priorities from projects
3. **Inbox** — items needing attention
4. **Metrics** — any available numbers (revenue, goals, etc.)
5. **Flags** — any alerts or anomalies

Use tables and bullet points. Keep it under 500 words. Current date: ${new Date().toLocaleDateString()}`,
    prompt: `Current state:\n${state.slice(0, 3000)}`,
    model: "claude-haiku-4-5-20251001",
  });

  if (!ok || !text) return "Dashboard generation failed.";

  const output = `# EDDIE Dashboard\n_Generated: ${new Date().toLocaleString()}_\n\n${text}`;
  await Bun.write(DASHBOARD_OUTPUT, output);
  logger.info("dashboard-gen:complete");
  return output;
}
