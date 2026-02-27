import type { Bot } from "gramio";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes

let lastWarnAt = 0;

export type MemStats = {
  totalMB: number;
  availMB: number;
  freeMB: number;
  pctFree: number;
};

export async function readMemInfo(): Promise<MemStats> {
  try {
    const text = await Bun.file("/proc/meminfo").text();
    const parse = (key: string): number => {
      const match = text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
      return match ? parseInt(match[1]!, 10) : 0;
    };
    const totalMB = Math.round(parse("MemTotal") / 1024);
    const availMB = Math.round(parse("MemAvailable") / 1024);
    const freeMB = Math.round(parse("MemFree") / 1024);
    const pctFree = totalMB > 0 ? Math.round((availMB / totalMB) * 100) : 0;
    return { totalMB, availMB, freeMB, pctFree };
  } catch {
    return { totalMB: 0, availMB: 0, freeMB: 0, pctFree: 0 };
  }
}

async function checkMemory(bot: Bot): Promise<void> {
  const { totalMB, availMB, pctFree } = await readMemInfo();
  if (totalMB === 0) return;

  if (availMB < config.MEMORY_WARN_MB) {
    const now = Date.now();
    if (now - lastWarnAt < config.MEMORY_WARN_COOLDOWN_MS) return;
    lastWarnAt = now;

    logger.warn("memory-monitor:low-ram", { availMB, totalMB, pctFree });

    try {
      await bot.api.sendMessage({
        chat_id: config.OWNER_TELEGRAM_ID,
        text: `Low RAM: ${availMB}MB free (${pctFree}% of ${totalMB}MB). Background jobs may get killed by OOM.`,
      });
    } catch (err) {
      logger.error("memory-monitor:notify-error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function startMemoryMonitor(bot: Bot): void {
  logger.info("memory-monitor:start", {
    warnMB: config.MEMORY_WARN_MB,
    intervalMs: POLL_INTERVAL_MS,
  });

  // Check immediately on start
  checkMemory(bot).catch(() => {});

  setInterval(() => {
    checkMemory(bot).catch(() => {});
  }, POLL_INTERVAL_MS);
}
