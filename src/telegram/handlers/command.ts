import type { ContextType, BotLike } from "@gramio/contexts";
import { checkClaude } from "../../claude/health.ts";
import { resetSession } from "../../claude/session.ts";
import { storeFact } from "../../memory/store.ts";
import { searchMemory } from "../../memory/search.ts";
import { getSupabase, memoryEnabled } from "../../memory/client.ts";
import { initiateCall } from "../../voice/call.ts";
import {
  startBrainstorm,
  endBrainstorm,
  isInBrainstorm,
} from "../../proactive/brainstorm.ts";
import {
  listCronJobs,
  createCronJob,
  deleteCronJob,
  toggleCronJob,
} from "../../proactive/cron.ts";
import { config } from "../../config.ts";
import {
  createJob,
  getRecentJobs,
  updateJob,
  getJob,
} from "../../jobs/manager.ts";
import { spawnJob, killSession } from "../../jobs/tmux.ts";
import { listAgents } from "../../agents/registry.ts";
import { startWheel, stopWheel, isWheelActive } from "../../proactive/wheel.ts";
import { runMorningBrief } from "../../proactive/morning-brief.ts";
import { logProjectActivity } from "../../memory/activity.ts";

type MessageContext = ContextType<BotLike, "message">;

export async function handleStart(context: MessageContext): Promise<void> {
  await context.send(
    "EDDIE online. Send me a message and I'll relay it to Claude.",
  );
}

export async function handleStatus(context: MessageContext): Promise<void> {
  const health = await checkClaude();

  if (health.ok) {
    const msg = health.version
      ? `Claude is healthy. Model: ${health.version}`
      : "Claude is healthy.";
    await context.send(msg);
  } else {
    await context.send(`Claude health check failed: ${health.error}`);
  }
}

export async function handleNewSession(context: MessageContext): Promise<void> {
  const chatId = context.chat.id;
  const sessionId = await resetSession(chatId);
  await context.send(`Session reset. New session: ${sessionId.slice(0, 8)}...`);
}

export async function handleRemember(context: MessageContext): Promise<void> {
  if (!memoryEnabled) {
    await context.send("Memory not configured.");
    return;
  }
  const text = context.text?.replace(/^\/remember\s*/, "").trim();
  if (!text) {
    await context.send("Usage: /remember <something to remember>");
    return;
  }
  await storeFact(text, "fact", "telegram");
  await context.send("Remembered.");
}

export async function handleForget(context: MessageContext): Promise<void> {
  if (!memoryEnabled) {
    await context.send("Memory not configured.");
    return;
  }
  const text = context.text?.replace(/^\/forget\s*/, "").trim();
  if (!text) {
    await context.send("Usage: /forget <something to forget>");
    return;
  }
  const results = await searchMemory(text, 5, 0.5);
  const factIds = results.filter((r) => r.source === "facts").map((r) => r.id);
  if (factIds.length === 0) {
    await context.send("No matching memories found.");
    return;
  }
  const { error } = await getSupabase()
    .from("facts")
    .update({ active: false, updated_at: new Date().toISOString() })
    .in("id", factIds);
  if (error) {
    await context.send(`Error: ${error.message}`);
    return;
  }
  await context.send(
    `Forgot ${factIds.length} matching memory${factIds.length > 1 ? "ies" : ""}.`,
  );
}

export async function handleGoals(context: MessageContext): Promise<void> {
  if (!memoryEnabled) {
    await context.send("Memory not configured.");
    return;
  }
  const { data, error } = await getSupabase()
    .from("facts")
    .select("content, created_at")
    .eq("category", "goal")
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (error) {
    await context.send(`Error: ${error.message}`);
    return;
  }
  if (!data || data.length === 0) {
    await context.send("No active goals.");
    return;
  }
  const list = data.map((f, i) => `${i + 1}. ${f.content}`).join("\n");
  await context.send(`Active goals:\n${list}`);
}

const voiceReplyState = new Map<number, boolean>();
const modeStateMap = new Map<number, "auto" | "draft">();

async function upsertSetting(
  chatId: number,
  key: string,
  value: string,
): Promise<void> {
  if (!memoryEnabled) return;
  const { error } = await getSupabase()
    .from("user_settings")
    .upsert(
      { chat_id: chatId, key, value, updated_at: new Date().toISOString() },
      { onConflict: "chat_id,key" },
    );
  if (
    error &&
    !error.message.includes("schema cache") &&
    !error.message.includes("does not exist")
  ) {
    console.warn("user_settings:upsert-error", error.message);
  }
}

export async function loadUserSettings(): Promise<void> {
  if (!memoryEnabled) return;
  const { data } = await getSupabase()
    .from("user_settings")
    .select("chat_id, key, value");
  if (!data) return;
  for (const row of data) {
    const chatId = row.chat_id as number;
    if (row.key === "voiceReply")
      voiceReplyState.set(chatId, row.value === "true");
    if (row.key === "mode")
      modeStateMap.set(chatId, row.value as "auto" | "draft");
  }
}

export function isVoiceReplyEnabled(chatId: number): boolean {
  return voiceReplyState.get(chatId) ?? false;
}

export async function handleVoiceReply(context: MessageContext): Promise<void> {
  const chatId = context.chat.id;
  const current = isVoiceReplyEnabled(chatId);
  const next = !current;
  voiceReplyState.set(chatId, next);
  await upsertSetting(chatId, "voiceReply", String(next));
  await context.send(`Voice replies ${next ? "enabled" : "disabled"}.`);
}

export async function handleBrainstorm(context: MessageContext): Promise<void> {
  const chatId = context.chat.id;
  const text = context.text?.replace(/^\/brainstorm\s*/, "").trim();

  if (!text && isInBrainstorm(chatId)) {
    endBrainstorm(chatId);
    await context.send("Brainstorm ended.");
    return;
  }

  if (!text) {
    await context.send(
      "Usage: /brainstorm <topic>\nWhile active, send /brainstorm to end.",
    );
    return;
  }

  startBrainstorm(chatId, text);
  await context.send(`Brainstorm started: "${text}"\nSend /brainstorm to end.`);
}

export async function handleCall(context: MessageContext): Promise<void> {
  const sid = config.TWILIO_ACCOUNT_SID;
  const phone = config.OWNER_PHONE;
  const webhookPort = config.TWILIO_WEBHOOK_PORT;

  if (!sid || !phone) {
    await context.send(
      "Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, and OWNER_PHONE.",
    );
    return;
  }

  const webhookUrl = config.TWILIO_WEBHOOK_URL;
  const webhookBaseUrl = webhookUrl || `https://localhost:${webhookPort}`;
  try {
    const result = await initiateCall(phone, webhookBaseUrl);
    await context.send(
      `Call initiated. SID: ${result.sid}, Status: ${result.status}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await context.send(`Call failed: ${msg}`);
  }
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

export async function handleRun(context: MessageContext): Promise<void> {
  const text = context.text?.replace(/^\/run\s*/, "").trim() ?? "";
  if (!text) {
    await context.send(
      "Usage: /run [--model claude|kimi] [--timeout <minutes>] <prompt>",
    );
    return;
  }

  let model: "claude" | "kimi" = "claude";
  let timeoutMs: number | undefined;
  let prompt = text;

  // Parse --model flag
  const modelMatch = prompt.match(/^--model\s+(claude|kimi)\s+/i);
  if (modelMatch) {
    model = modelMatch[1]!.toLowerCase() as "claude" | "kimi";
    prompt = prompt.slice(modelMatch[0].length).trim();
  }

  // Parse --timeout flag
  const timeoutMatch = prompt.match(/^--timeout\s+(\d+)\s+/i);
  if (timeoutMatch) {
    timeoutMs = parseInt(timeoutMatch[1]!, 10) * 60_000;
    prompt = prompt.slice(timeoutMatch[0].length).trim();
  }

  if (!prompt) {
    await context.send(
      "Usage: /run [--model claude|kimi] [--timeout <minutes>] <prompt>",
    );
    return;
  }

  const job = await createJob(model, prompt);
  if (timeoutMs) {
    await updateJob(job.id, { timeoutMs });
    job.timeoutMs = timeoutMs;
  }
  await spawnJob(job);
  await context.send(
    `Job #${job.id} started (${model}${timeoutMs ? `, timeout: ${timeoutMs / 60_000}m` : ""}). Session: ${job.tmuxSession}`,
  );
}

export async function handleJobs(context: MessageContext): Promise<void> {
  const jobs = await getRecentJobs(10);
  if (jobs.length === 0) {
    await context.send("No jobs yet.");
    return;
  }
  const lines = jobs.map((j) => {
    const started = new Date(j.startedAt).toLocaleString("en-US", {
      timeZone: config.TIMEZONE,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const dur = j.durationMs ? ` (${Math.round(j.durationMs / 1000)}s)` : "";
    return `#${j.id} | ${j.model} | ${j.status}${dur} | ${started}`;
  });
  await context.send(`Recent jobs:\n${lines.join("\n")}`);
}

export async function handleKill(context: MessageContext): Promise<void> {
  const jobId = context.text?.replace(/^\/kill\s*/, "").trim();
  if (!jobId) {
    await context.send("Usage: /kill <job-id>");
    return;
  }
  const job = await getJob(jobId);
  if (!job) {
    await context.send(`Job #${jobId} not found.`);
    return;
  }
  if (job.status !== "running") {
    await context.send(`Job #${jobId} is not running (status: ${job.status}).`);
    return;
  }
  const killed = await killSession(job.tmuxSession);
  if (killed) {
    await updateJob(jobId, {
      status: "killed",
      completedAt: new Date().toISOString(),
    });
    await context.send(`Job #${jobId} killed.`);
  } else {
    await context.send(`Failed to kill job #${jobId}.`);
  }
}

export function getChatMode(chatId: number): "auto" | "draft" {
  return modeStateMap.get(chatId) ?? "auto";
}

export async function handleMode(context: MessageContext): Promise<void> {
  const chatId = context.chat.id;
  const current = getChatMode(chatId);
  const next = current === "auto" ? "draft" : "auto";
  modeStateMap.set(chatId, next);
  await upsertSetting(chatId, "mode", next);
  const desc =
    next === "draft"
      ? "Draft mode enabled. External actions will show drafts before executing."
      : "Auto mode enabled. Actions execute directly.";
  await context.send(desc);
}

export async function handleConsolidate(
  context: MessageContext,
): Promise<void> {
  await context.send("Running consolidation...");
  try {
    const { runConsolidation } = await import("../../proactive/consolidate.ts");
    await runConsolidation();
    await context.send("Done. eddie-current.md updated.");
  } catch (err) {
    await context.send(
      `Consolidation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * /collab-log <project-slug> <summary>
 * Logs a COLLAB activity entry for the current session to both Brain Vault locations.
 * Use at end of sessions where Nicholas and Eddie worked together on a specific project.
 */
export async function handleCollabLog(context: MessageContext): Promise<void> {
  const args = context.text?.replace(/^\/collab-log\s*/, "").trim() ?? "";
  const spaceIdx = args.indexOf(" ");
  if (!args || spaceIdx === -1) {
    await context.send(
      "Usage: /collab-log <project-slug> <summary>\nExample: /collab-log crabill-leadgen Reviewed landing page copy and updated CTA",
    );
    return;
  }
  const slug = args.slice(0, spaceIdx).trim();
  const summary = args.slice(spaceIdx + 1).trim();
  try {
    await logProjectActivity(slug, summary, "COLLAB");
    await context.send(`Logged to ${slug}: [COLLAB] ${summary}`);
  } catch (err) {
    await context.send(
      `Failed to log: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function handleAgents(context: MessageContext): Promise<void> {
  const agents = await listAgents();
  if (agents.length === 0) {
    await context.send("No agents found in ~/.claude/agents/");
    return;
  }
  const lines = agents.map(
    (a) =>
      `• ${a.slug} [${a.model}] — ${a.description.slice(0, 80) || "(no description)"}`,
  );
  const chunks: string[] = [];
  let current = `Agents (${agents.length}):\n`;
  for (const line of lines) {
    if (current.length + line.length + 1 > 4000) {
      chunks.push(current);
      current = "";
    }
    current += line + "\n";
  }
  if (current) chunks.push(current);
  for (const chunk of chunks) {
    await context.send(chunk);
  }
}

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

const CHANNEL_LABELS: Record<string, string> = {
  gmail: "📧 Gmail",
  "gmail-eddie": "📧 EDDIE Mail",
  "google-calendar": "📅 Google Calendar",
  "icloud-calendar": "📅 iCloud Calendar",
  imessage: "💬 iMessage",
  slack: "💬 Slack",
  whatsapp: "💬 WhatsApp",
};

export async function handleInbox(context: MessageContext): Promise<void> {
  const args = context.text?.replace(/^\/inbox\s*/, "").trim() ?? "";
  const [subArg, idArg] = args.split(/\s+/);

  try {
    const { getItems, markRead } = await import("../../comms/inbox.ts");

    // /inbox read <id>
    if (subArg === "read" && idArg) {
      await markRead(idArg);
      await context.send(`Marked ${idArg} as read.`);
      return;
    }

    const channel = subArg as
      | import("../../comms/types.ts").ChannelId
      | undefined;
    const validChannels = [
      "gmail",
      "gmail-eddie",
      "google-calendar",
      "icloud-calendar",
      "imessage",
      "slack",
      "whatsapp",
    ];
    const filterChannel = validChannels.includes(channel ?? "")
      ? channel
      : undefined;

    const items = await getItems({
      channel: filterChannel,
      status: "unread",
      limit: 10,
    });
    if (items.length === 0) {
      await context.send(
        filterChannel
          ? `No unread items in ${filterChannel}.`
          : "Inbox is empty.",
      );
      return;
    }

    const lines = items.map((item) => {
      const ch = CHANNEL_LABELS[item.channel] ?? item.channel;
      const from = item.from.slice(0, 40);
      const subj = item.subject ? ` — ${item.subject.slice(0, 50)}` : "";
      const preview = item.preview.slice(0, 80);
      return `[${item.id?.slice(0, 8)}] ${ch}\nFrom: ${from}${subj}\n${preview}`;
    });

    await context.send(
      `Unread (${items.length}):\n\n${lines.join("\n\n─────\n\n")}`,
    );
  } catch (err) {
    await context.send(
      `Inbox error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function handleChannels(context: MessageContext): Promise<void> {
  try {
    const { getPollerStatus } = await import("../../comms/index.ts");
    const { getUnreadCount } = await import("../../comms/inbox.ts");

    const [pollers, counts] = await Promise.all([
      Promise.resolve(getPollerStatus()),
      getUnreadCount(),
    ]);

    if (pollers.length === 0) {
      await context.send(
        "No channels active. Set COMMS_ENABLED=true and configure channels.",
      );
      return;
    }

    const lines = pollers.map((p) => {
      const label = CHANNEL_LABELS[p.channel] ?? p.channel;
      const unread =
        counts[p.channel as import("../../comms/types.ts").ChannelId] ?? 0;
      const errors =
        p.consecutiveErrors > 0 ? ` ⚠️ ${p.consecutiveErrors} errors` : "";
      const last = p.lastPolledAt
        ? new Date(p.lastPolledAt).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })
        : "never";
      return `${label}${errors}\n  Unread: ${unread} · Last poll: ${last}`;
    });

    await context.send(`Channels:\n\n${lines.join("\n\n")}`);
  } catch (err) {
    await context.send(
      `Channels error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function handleCalendar(context: MessageContext): Promise<void> {
  const args = context.text?.replace(/^\/calendar\s*/, "").trim() ?? "";
  const days = args === "tomorrow" ? 2 : args === "week" ? 7 : 1;
  const label = days === 1 ? "today" : days === 2 ? "tomorrow" : "this week";

  try {
    const { getUpcomingCalendarEvents } =
      await import("../../comms/google/calendar.ts");
    const events = await getUpcomingCalendarEvents(days);
    await context.send(`Calendar ${label}:\n\n${events}`);
  } catch (err) {
    await context.send(
      `Calendar error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function handleDrive(context: MessageContext): Promise<void> {
  const query = context.text?.replace(/^\/drive\s*/, "").trim() ?? "";
  if (!query) {
    await context.send("Usage: /drive <search query>");
    return;
  }
  try {
    const { searchDrive, formatDriveResults } =
      await import("../../comms/google/drive.ts");
    const files = await searchDrive(query);
    const result = await formatDriveResults(files);
    await context.send(`Drive results for "${query}":\n\n${result}`);
  } catch (err) {
    await context.send(
      `Drive error: ${err instanceof Error ? err.message : String(err)}`,
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

export async function handleSlack(context: MessageContext): Promise<void> {
  try {
    const { getItems } = await import("../../comms/inbox.ts");
    const items = await getItems({
      channel: "slack",
      status: "unread",
      limit: 10,
    });
    if (items.length === 0) {
      await context.send("No unread Slack messages.");
      return;
    }
    const lines = items.map((item) => {
      const from = item.from.slice(0, 30);
      const preview = item.preview.slice(0, 120);
      const ch = (item.metadata?.channelId as string) ?? "";
      return `${from}${ch ? ` in #${ch}` : ""}:\n${preview}`;
    });
    await context.send(
      `Slack (${items.length} unread):\n\n${lines.join("\n\n")}`,
    );
  } catch (err) {
    await context.send(
      `Slack error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
