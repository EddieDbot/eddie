import { config } from "../../config.ts";
import { runPrompt } from "../../claude/run-prompt.ts";
import { logger } from "../../utils/logger.ts";
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string,
): boolean {
  try {
    const fiveMinAgo = Math.floor(Date.now() / 1000) - 5 * 60;
    if (parseInt(timestamp, 10) < fiveMinAgo) return false;

    const baseString = `v0:${timestamp}:${body}`;
    const hmac = createHmac("sha256", signingSecret)
      .update(baseString)
      .digest("hex");
    const computed = `v0=${hmac}`;

    return timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function handleSlashRun(
  text: string,
  _userId: string,
): Promise<{ text: string }> {
  if (!text.trim()) {
    return { text: "Usage: /run <job prompt>" };
  }
  try {
    const { createJob } = await import("../../jobs/manager.ts");
    const { spawnJob } = await import("../../jobs/tmux.ts");
    const job = await createJob("claude", text);
    await spawnJob(job);
    return {
      text: `Job started: ${job.id.slice(0, 8)} — ${text.slice(0, 60)}`,
    };
  } catch (err) {
    logger.error("slack-cmd:run-error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { text: "Failed to start job." };
  }
}

export async function handleSlashBrief(): Promise<{ text: string }> {
  try {
    const { buildBriefText } = await import("../../proactive/morning-brief.ts");
    const brief = await buildBriefText();
    return { text: brief };
  } catch (err) {
    logger.error("slack-cmd:brief-error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { text: "Brief failed." };
  }
}

export async function handleSlashAlign(
  text: string,
): Promise<{ text: string }> {
  if (!text.trim()) return { text: "Usage: /align <idea>" };

  const { text: result, ok } = await runPrompt({
    system:
      "Score how well this idea aligns with a creative technologist/director vision. Reply: Score: X/100\n[1-2 sentence reason]",
    prompt: `Idea: ${text}`,
    model: "claude-haiku-4-5-20251001",
  });
  if (!ok) return { text: "Align check failed." };
  return { text: result || "Could not score." };
}

export async function handleSlackCommand(
  command: string,
  text: string,
  userId: string,
): Promise<{ text: string }> {
  switch (command) {
    case "/run":
      return handleSlashRun(text, userId);
    case "/brief":
      return handleSlashBrief();
    case "/align":
      return handleSlashAlign(text);
    default:
      return { text: `Unknown command: ${command}` };
  }
}
