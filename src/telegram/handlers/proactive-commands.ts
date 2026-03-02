import type { MessageContext } from "./shared.ts";
import { config } from "../../config.ts";
import { getSupabase, memoryEnabled } from "../../memory/client.ts";
import { startWheel, stopWheel } from "../../proactive/wheel.ts";
import { runMorningBrief } from "../../proactive/morning-brief.ts";
import {
  listCronJobs,
  createCronJob,
  deleteCronJob,
  toggleCronJob,
} from "../../proactive/cron.ts";

export async function handleWheel(context: MessageContext): Promise<void> {
  const text = context.text?.replace(/^\/wheel\s*/, "").trim() ?? "";

  if (text === "stop") {
    const session = stopWheel();
    if (!session) {
      await context.send("Wheel is not active.");
      return;
    }
    const durationMin = Math.round((Date.now() - session.startedAt) / 60_000);
    await context.send(
      `Wheel disengaged. Duration: ${durationMin}m, Jobs spawned: ${session.jobsSpawned}`,
    );
    return;
  }

  const bot = (context as unknown as { bot: import("gramio").Bot }).bot;
  await startWheel(bot, text || undefined);
}

export async function handleBrief(context: MessageContext): Promise<void> {
  const topic = context.text?.replace(/^\/brief\s*/, "").trim();
  if (topic) {
    const { generateContentBrief } =
      await import("../../proactive/content-brief.ts");
    const brief = await generateContentBrief(topic);
    await context.send(brief);
    return;
  }
  await context.send("Generating morning brief...");
  try {
    const bot = (context as unknown as { bot: import("gramio").Bot }).bot;
    await runMorningBrief(bot);
  } catch (err) {
    await context.send(
      `Brief failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function handlePlaylist(context: MessageContext): Promise<void> {
  await context.send("Playlist tracking is not available in this build.");
}

export async function handlePlanReports(
  context: MessageContext,
): Promise<void> {
  await context.send(
    "Synthesizing all playlist reports into execution roadmap...",
  );
  try {
    const { runReportSynthesis } =
      await import("../../proactive/report-synthesis.ts");
    const { jobId, session } = await runReportSynthesis();
    await context.send(
      `Synthesis job #${jobId} started.\nSession: ${session}\nRoadmap → Brain Vault/90 - Agent Memory/Plans/execution-roadmap.md`,
    );
  } catch (err) {
    await context.send(
      `Synthesis failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function handleCron(context: MessageContext): Promise<void> {
  if (!memoryEnabled) {
    await context.send("Memory not configured — cron not available.");
    return;
  }

  const text = context.text?.replace(/^\/cron\s*/, "").trim() ?? "";
  const parts = text.split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "list";

  if (subcommand === "list" || subcommand === "") {
    const jobs = await listCronJobs();
    if (jobs.length === 0) {
      await context.send("No cron jobs configured.");
      return;
    }
    const lines = jobs.map((j) => {
      const status = j.enabled ? "on" : "off";
      const next = new Date(j.next_run_at).toLocaleString("en-US", {
        timeZone: config.TIMEZONE,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      return `[${status}] ${j.name} — ${j.schedule_type} ${j.schedule_value} — next: ${next}\n  "${j.prompt.slice(0, 80)}"`;
    });
    await context.send(`Cron jobs:\n${lines.join("\n\n")}`);
    return;
  }

  if (subcommand === "add") {
    if (parts.length < 5) {
      await context.send(
        "Usage: /cron add <name> <schedule_type> <schedule_value> <prompt>\n\nSchedule types: interval (2h, 30m), daily (09:00), weekdays (06:30), weekly (sun 20:00)",
      );
      return;
    }
    const name = parts[1]!;
    if (!/^[\w-]{1,50}$/.test(name)) {
      await context.send(
        "Invalid name. Use letters, numbers, hyphens, underscores (max 50).",
      );
      return;
    }
    const scheduleType = parts[2] as
      | "interval"
      | "daily"
      | "weekdays"
      | "weekly";
    const validTypes = ["interval", "daily", "weekdays", "weekly"];
    if (!validTypes.includes(scheduleType)) {
      await context.send(
        `Invalid schedule type: ${scheduleType}\nValid: ${validTypes.join(", ")}`,
      );
      return;
    }
    const scheduleValue = parts[3]!;
    const prompt = parts.slice(4).join(" ");
    try {
      const job = await createCronJob(
        name,
        scheduleType,
        scheduleValue,
        prompt,
      );
      const next = new Date(job.next_run_at).toLocaleString("en-US", {
        timeZone: config.TIMEZONE,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      await context.send(`Cron job "${name}" created. Next run: ${next}`);
    } catch (err) {
      await context.send(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  if (subcommand === "remove") {
    const name = parts[1];
    if (!name) {
      await context.send("Usage: /cron remove <name>");
      return;
    }
    const ok = await deleteCronJob(name);
    await context.send(
      ok ? `Removed "${name}".` : `Failed to remove "${name}".`,
    );
    return;
  }

  if (subcommand === "pause") {
    const name = parts[1];
    if (!name) {
      await context.send("Usage: /cron pause <name>");
      return;
    }
    const ok = await toggleCronJob(name, false);
    await context.send(ok ? `Paused "${name}".` : `Failed to pause "${name}".`);
    return;
  }

  if (subcommand === "resume") {
    const name = parts[1];
    if (!name) {
      await context.send("Usage: /cron resume <name>");
      return;
    }
    const ok = await toggleCronJob(name, true);
    await context.send(
      ok ? `Resumed "${name}".` : `Failed to resume "${name}".`,
    );
    return;
  }

  await context.send(
    "Unknown subcommand. Use: list, add, remove, pause, resume",
  );
}

export async function handleHeartbeat(context: MessageContext): Promise<void> {
  if (!memoryEnabled) {
    await context.send("Memory not configured — no heartbeat logs available.");
    return;
  }

  const { data, error } = await getSupabase()
    .from("heartbeat_log")
    .select("decision, summary, message_sent, duration_ms, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    await context.send(`Error: ${error.message}`);
    return;
  }

  if (!data || data.length === 0) {
    await context.send("No heartbeat activity yet.");
    return;
  }

  const lines = data.map((h) => {
    const time = new Date(h.created_at).toLocaleString("en-US", {
      timeZone: config.TIMEZONE,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const dur = h.duration_ms ? ` (${(h.duration_ms / 1000).toFixed(1)}s)` : "";
    const summary = h.summary ? ` — ${h.summary}` : "";
    return `${time}: ${h.decision}${dur}${summary}`;
  });

  await context.send(`Recent heartbeats:\n${lines.join("\n")}`);
}
