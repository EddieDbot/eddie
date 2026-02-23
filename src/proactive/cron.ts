import type { Bot } from "gramio";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logCommunication } from "../memory/store.ts";
import { relayHeartbeat } from "../claude/relay.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

export type CronJob = {
  id: string;
  name: string;
  schedule_type: "interval" | "daily" | "weekdays" | "weekly";
  schedule_value: string;
  prompt: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
};

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];
const ALL_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function nowInTimezone(timezone: string): Date {
  const str = new Date().toLocaleString("en-US", { timeZone: timezone });
  return new Date(str);
}

const MIN_INTERVAL_MS = 5 * 60_000;

function parseInterval(value: string): number {
  const match = value.match(/^(\d+)(m|h)$/);
  if (!match)
    throw new Error(
      `Invalid interval: ${value}. Use format like "30m" or "2h".`,
    );
  const [, num, unit] = match;
  const ms = unit === "h" ? Number(num!) * 3_600_000 : Number(num!) * 60_000;
  if (ms < MIN_INTERVAL_MS)
    throw new Error(`Interval too short (min 5m): ${value}`);
  return ms;
}

function parseTime(value: string): { hours: number; minutes: number } {
  if (!/^\d{1,2}:\d{2}$/.test(value))
    throw new Error(`Invalid time format: ${value}. Use HH:MM.`);
  const [h, m] = value.split(":");
  const hours = Number(h);
  const minutes = Number(m);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time: ${value}. Hours 0-23, minutes 0-59.`);
  }
  return { hours, minutes };
}

export function computeNextRun(
  scheduleType: CronJob["schedule_type"],
  scheduleValue: string,
  timezone: string,
  from?: Date,
): Date {
  const now = from ?? nowInTimezone(timezone);

  if (scheduleType === "interval") {
    return new Date(now.getTime() + parseInterval(scheduleValue));
  }

  if (scheduleType === "daily") {
    const { hours, minutes } = parseTime(scheduleValue);
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }

  if (scheduleType === "weekdays") {
    const { hours, minutes } = parseTime(scheduleValue);
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    while (!WEEKDAYS.includes(ALL_DAYS[next.getDay()]!)) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  if (scheduleType === "weekly") {
    const parts = scheduleValue.split(" ");
    const dayStr = parts[0]!.toLowerCase();
    const { hours, minutes } = parseTime(parts[1]!);
    const targetDay = ALL_DAYS.indexOf(dayStr);
    if (targetDay === -1) throw new Error(`Invalid day: ${dayStr}`);
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    const currentDay = next.getDay();
    let daysAhead = targetDay - currentDay;
    if (daysAhead < 0 || (daysAhead === 0 && next <= now)) daysAhead += 7;
    next.setDate(next.getDate() + daysAhead);
    return next;
  }

  throw new Error(`Unknown schedule type: ${scheduleType}`);
}

export async function createCronJob(
  name: string,
  scheduleType: CronJob["schedule_type"],
  scheduleValue: string,
  prompt: string,
): Promise<CronJob> {
  const nextRunAt = computeNextRun(
    scheduleType,
    scheduleValue,
    config.TIMEZONE,
  );
  const { data, error } = await getSupabase()
    .from("cron_jobs")
    .insert({
      name,
      schedule_type: scheduleType,
      schedule_value: scheduleValue,
      prompt,
      next_run_at: nextRunAt.toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create cron job: ${error.message}`);
  return data as CronJob;
}

export async function listCronJobs(): Promise<CronJob[]> {
  const { data, error } = await getSupabase()
    .from("cron_jobs")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("cron:list", { error: error.message });
    return [];
  }
  return (data ?? []) as CronJob[];
}

export async function deleteCronJob(name: string): Promise<boolean> {
  const { error } = await getSupabase()
    .from("cron_jobs")
    .delete()
    .eq("name", name);

  if (error) {
    logger.error("cron:delete", { error: error.message });
    return false;
  }
  return true;
}

export async function toggleCronJob(
  name: string,
  enabled: boolean,
): Promise<boolean> {
  const { error } = await getSupabase()
    .from("cron_jobs")
    .update({ enabled })
    .eq("name", name);

  if (error) {
    logger.error("cron:toggle", { error: error.message });
    return false;
  }
  return true;
}

export async function getDueCronJobs(): Promise<CronJob[]> {
  const now = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from("cron_jobs")
    .select("*")
    .eq("enabled", true)
    .lte("next_run_at", now);

  if (error) {
    logger.error("cron:get-due", { error: error.message });
    return [];
  }
  return (data ?? []) as CronJob[];
}

async function markCronJobRun(
  name: string,
  scheduleType: CronJob["schedule_type"],
  scheduleValue: string,
): Promise<void> {
  const now = new Date();
  const nextRunAt = computeNextRun(
    scheduleType,
    scheduleValue,
    config.TIMEZONE,
    now,
  );
  const { error } = await getSupabase()
    .from("cron_jobs")
    .update({
      last_run_at: now.toISOString(),
      next_run_at: nextRunAt.toISOString(),
    })
    .eq("name", name);

  if (error) logger.error("cron:mark-run", { error: error.message });
}

export async function executeCronJob(job: CronJob, bot: Bot): Promise<void> {
  logger.info("cron:execute", {
    name: job.name,
    prompt: job.prompt.slice(0, 80),
  });

  try {
    const result = await relayHeartbeat(job.prompt);
    if (result.text && !result.text.includes("HEARTBEAT_OK")) {
      await bot.api.sendMessage({
        chat_id: config.OWNER_TELEGRAM_ID,
        text: `[cron: ${job.name}]\n${result.text}`,
      });
      if (memoryEnabled) {
        await logCommunication(
          "proactive",
          "outbound",
          `[cron:${job.name}] ${result.text.slice(0, 100)}`,
        );
      }
    }
    await markCronJobRun(job.name, job.schedule_type, job.schedule_value);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("cron:execute-error", { name: job.name, error: errorMsg });
    await markCronJobRun(job.name, job.schedule_type, job.schedule_value);
    const { triggerSelfHeal } = await import("../jobs/self-heal.ts");
    triggerSelfHeal(
      {
        source: "cron",
        name: job.name,
        error: errorMsg,
        timestamp: Date.now(),
      },
      bot,
    ).catch(() => {});
  }
}
