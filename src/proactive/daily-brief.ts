import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";
import { STATE_DIR } from "../memory/brain-vault-paths.ts";

function todayISODate(): string {
  return new Date().toLocaleDateString("sv", { timeZone: config.TIMEZONE });
}

function getBriefPath(): string {
  return resolve(STATE_DIR, `daily-brief-${todayISODate()}.md`);
}

export async function gatherBriefData(): Promise<string> {
  const date = todayISODate();
  const parts: string[] = [`# Daily Brief — ${date}\n`];

  try {
    const { getTodayRatings } = await import("./pillars.ts");
    const ratings = await getTodayRatings();
    if (ratings.length > 0) {
      parts.push("## Pillar Ratings");
      ratings.forEach((r) =>
        parts.push(
          `- ${r.pillar}: ${r.score}/10${r.note ? ` — ${r.note}` : ""}`,
        ),
      );
      parts.push("");
    }
  } catch {}

  try {
    const { getTodayNonNegs, getStreaks } = await import("./pillars.ts");
    const [items, streaks] = await Promise.all([
      getTodayNonNegs(),
      getStreaks(),
    ]);
    if (items.length > 0) {
      parts.push("## Non-Negotiables");
      items.forEach((item) => {
        const streak = streaks.get(item.name) ?? 0;
        const check = item.completed ? "✓" : "○";
        parts.push(
          `- ${check} ${item.name}${streak > 1 ? ` (${streak}d streak)` : ""}`,
        );
      });
      parts.push("");
    }
  } catch {}

  parts.push(`*Last updated: ${new Date().toISOString()}*`);
  return parts.join("\n");
}

export async function writeDailyBrief(): Promise<string> {
  const content = await gatherBriefData();
  const path = getBriefPath();
  await Bun.write(path, content);
  logger.info("daily-brief:written", { path });
  return path;
}

export async function updateDailyBrief(): Promise<void> {
  try {
    const content = await gatherBriefData();
    const path = getBriefPath();
    await Bun.write(path, content);
    logger.debug("daily-brief:updated", { path });
  } catch (err) {
    logger.warn("daily-brief:update-error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startDailyBriefUpdater(): void {
  if (!config.DAILY_BRIEF_ENABLED) return;

  const intervalMs = config.DAILY_BRIEF_INTERVAL_MS;
  logger.info("daily-brief:started", { intervalMs });
  setInterval(() => {
    updateDailyBrief().catch(() => {});
  }, intervalMs);
  writeDailyBrief().catch(() => {});
}
