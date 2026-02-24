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
  const args = context.text?.replace(/^\/playlist\s*/, "").trim() ?? "";

  // /playlist check — manual trigger
  if (args === "check") {
    await context.send("Checking playlists...");
    try {
      const { checkPlaylists } = await import("../../proactive/playlist.ts");
      const { spawned, checked } = await checkPlaylists();
      if (spawned === 0) {
        await context.send(`Checked ${checked} playlist(s). No new videos.`);
      } else {
        await context.send(
          `Checked ${checked} playlist(s). Spawned ${spawned} ingestion job(s). Watch /jobs for completion.`,
        );
      }
    } catch (err) {
      await context.send(
        `Playlist check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  // /playlist list — show configured playlists
  if (args === "list") {
    try {
      const { loadPlaylistsConfig } =
        await import("../../proactive/playlist.ts");
      const cfg = await loadPlaylistsConfig();
      if (cfg.playlists.length === 0) {
        await context.send(
          "No playlists configured. Add one:\n/playlist add <url> <name>",
        );
        return;
      }
      const lines = cfg.playlists.map(
        (p, i) => `${i + 1}. ${p.enabled ? "✅" : "⏸️"} ${p.name}\n   ${p.url}`,
      );
      await context.send(
        `Watched playlists (${cfg.playlists.length}):\n\n${lines.join("\n\n")}`,
      );
    } catch (err) {
      await context.send(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  // /playlist bucket — list transcripts waiting in the raw bucket
  if (args === "bucket") {
    try {
      const { listBucket } = await import("../../proactive/playlist.ts");
      const items = await listBucket();
      if (items.length === 0) {
        await context.send("Bucket is empty. Nothing waiting for routing.");
        return;
      }
      const lines = items.map(
        (item, i) =>
          `${i + 1}. ${item.filename}\n   ID: ${item.videoId}\n   Route: /playlist route ${item.videoId} <project>\n   Archive: /playlist archive ${item.videoId}`,
      );
      await context.send(
        `Bucket (${items.length} waiting):\n\n${lines.join("\n\n")}`,
      );
    } catch (err) {
      await context.send(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  // /playlist route <videoId> <project-slug> — move from bucket to project
  if (args.startsWith("route ")) {
    const parts = args.slice(6).trim().split(/\s+/);
    const videoId = parts[0];
    const projectSlug = parts[1];
    if (!videoId || !projectSlug) {
      await context.send(
        "Usage: /playlist route <videoId> <project-slug>\nExample: /playlist route vfLQTrS-gRc eddie",
      );
      return;
    }
    try {
      const { routeTranscript } = await import("../../proactive/playlist.ts");
      const result = await routeTranscript(videoId, projectSlug);
      if (result.ok) {
        await context.send(
          `Routed to ${projectSlug}.\n${result.from}\n→ ${result.to}`,
        );
      } else {
        await context.send(
          `Failed: ${"error" in result ? result.error : "unknown"}`,
        );
      }
    } catch (err) {
      await context.send(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  // /playlist archive <videoId> — move from bucket to unused
  if (args.startsWith("archive ")) {
    const videoId = args.slice(8).trim();
    if (!videoId) {
      await context.send("Usage: /playlist archive <videoId>");
      return;
    }
    try {
      const { archiveTranscript } = await import("../../proactive/playlist.ts");
      const result = await archiveTranscript(videoId);
      if (result.ok) {
        await context.send(`Archived to _unused/\n${result.path}`);
      } else {
        await context.send(
          `Failed: ${"error" in result ? result.error : "unknown"}`,
        );
      }
    } catch (err) {
      await context.send(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  // /playlist add <url> [name] — add a new playlist
  if (args.startsWith("add ")) {
    const rest = args.slice(4).trim();
    const parts = rest.match(/^(https?:\/\/\S+)\s*(.*)?$/);
    if (!parts) {
      await context.send("Usage: /playlist add <youtube-url> [optional name]");
      return;
    }
    const url = parts[1]!;
    const name =
      parts[2]?.trim() || "Playlist " + new Date().toISOString().split("T")[0];
    try {
      const { loadPlaylistsConfig, savePlaylistsConfig } =
        await import("../../proactive/playlist.ts");
      const cfg = await loadPlaylistsConfig();
      if (cfg.playlists.some((p) => p.url === url)) {
        await context.send("That playlist is already being watched.");
        return;
      }
      cfg.playlists.push({ name, url, enabled: true });
      await savePlaylistsConfig(cfg);
      await context.send(`Added: "${name}"\nWill check hourly at :00.`);
    } catch (err) {
      await context.send(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  // /playlist — show recent ingestion reports
  try {
    const { getRecentReports } = await import("../../proactive/playlist.ts");
    const reports = await getRecentReports(5);
    if (reports.length === 0) {
      await context.send(
        "No ingestion reports yet.\nAdd a playlist: /playlist add <url> [name]\nOr trigger a check: /playlist check",
      );
      return;
    }
    const lines = reports.map(
      (r, i) =>
        `${i + 1}. ${r.name}${r.summary ? `\n   ${r.summary.replace(/\n/g, " ")}` : ""}`,
    );
    await context.send(
      `Recent ingestions (${reports.length}):\n\n${lines.join("\n\n")}`,
    );
  } catch (err) {
    await context.send(
      `Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
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
