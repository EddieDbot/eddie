import { config } from "../../config.ts";
import { runPrompt } from "../../claude/run-prompt.ts";
import { logger } from "../../utils/logger.ts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSupabase, memoryEnabled } from "../../memory/client.ts";

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

export async function handleSlashStatus(): Promise<{ text: string }> {
  try {
    if (!memoryEnabled) return { text: "Status: memory not configured." };
    const { data, error } = await getSupabase()
      .from("jobs")
      .select("id, status")
      .in("status", ["running", "pending"]);
    if (error) return { text: `Status check failed: ${error.message}` };
    const running = (data ?? []).filter((j) => j.status === "running").length;
    const pending = (data ?? []).filter((j) => j.status === "pending").length;
    return {
      text: `Running: ${running} | Pending: ${pending} | Service: healthy`,
    };
  } catch (err) {
    logger.error("slack-cmd:status-error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { text: "Status check failed." };
  }
}

export async function handleSlashJobs(): Promise<{ text: string }> {
  try {
    if (!memoryEnabled) return { text: "Jobs: memory not configured." };
    const { data, error } = await getSupabase()
      .from("jobs")
      .select("id, model, status, started_at")
      .in("status", ["running", "pending"])
      .order("started_at", { ascending: false })
      .limit(10);
    if (error) return { text: `Jobs query failed: ${error.message}` };
    if (!data || data.length === 0) return { text: "No active jobs." };
    const lines = data.map(
      (j) =>
        `• ${j.id.slice(0, 8)} | ${j.model} | ${j.status} | ${j.started_at ?? "—"}`,
    );
    return { text: `Active jobs:\n${lines.join("\n")}` };
  } catch (err) {
    logger.error("slack-cmd:jobs-error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { text: "Jobs query failed." };
  }
}

export async function handleSlashBookmark(
  text: string,
): Promise<{ text: string }> {
  if (!text.trim())
    return { text: "Usage: /bookmark <url or label | content>" };
  if (!memoryEnabled) return { text: "Bookmark: memory not configured." };

  const pipeIdx = text.indexOf("|");
  let label: string, content: string;
  if (pipeIdx > 0) {
    label = text.slice(0, pipeIdx).trim();
    content = text.slice(pipeIdx + 1).trim();
  } else {
    label = `bookmark-${Date.now()}`;
    content = text.trim();
  }

  const { error } = await getSupabase()
    .from("bookmarks")
    .insert({ label, content });
  if (error) return { text: `Bookmark error: ${error.message}` };
  return { text: `Bookmarked: "${label}"` };
}

export async function handleSlashDashboard(): Promise<{ text: string }> {
  const port = config.DASHBOARD_PORT;
  return { text: `Dashboard: http://localhost:${port}` };
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
    case "/status":
      return handleSlashStatus();
    case "/jobs":
      return handleSlashJobs();
    case "/bookmark":
      return handleSlashBookmark(text);
    case "/dashboard":
      return handleSlashDashboard();
    default:
      return { text: `Unknown command: ${command}` };
  }
}
