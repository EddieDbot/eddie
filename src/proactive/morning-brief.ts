import { resolve } from "node:path";
import { homedir } from "node:os";
import type { Bot } from "gramio";
import { config } from "../config.ts";
import { runPrompt } from "../claude/run-prompt.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hour: h ?? 8, minute: m ?? 0 };
}

function msUntilTime(hour: number, minute: number, timezone: string): number {
  const now = new Date();
  const nowLocal = new Date(
    now.toLocaleString("en-US", { timeZone: timezone }),
  );
  const target = new Date(nowLocal);
  target.setHours(hour, minute, 0, 0);
  if (target <= nowLocal) target.setDate(target.getDate() + 1);
  return target.getTime() - nowLocal.getTime();
}

async function getActiveGoals(): Promise<string> {
  if (!memoryEnabled) return "Memory not configured.";
  try {
    const { data } = await getSupabase()
      .from("facts")
      .select("content")
      .eq("category", "goal")
      .eq("active", true);
    if (!data || data.length === 0) return "No active goals.";
    return data.map((g) => `- ${g.content}`).join("\n");
  } catch {
    return "Could not fetch goals.";
  }
}

async function getYesterdayActivity(): Promise<string> {
  if (!memoryEnabled) return "No activity data.";
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await getSupabase()
      .from("communication_log")
      .select("summary, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20);
    if (!data || data.length === 0) return "No activity yesterday.";
    return data.map((c) => `- ${c.summary}`).join("\n");
  } catch {
    return "Could not fetch activity.";
  }
}

type DailyActivity = {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
};
type DailyModelTokens = { date: string; tokensByModel: Record<string, number> };
type StatsCache = {
  dailyActivity?: DailyActivity[];
  dailyModelTokens?: DailyModelTokens[];
};

async function getYesterdayUsageStats(): Promise<string> {
  const tz = config.TIMEZONE;
  const localNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: tz }),
  );
  const yesterday = new Date(localNow);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10);

  try {
    const statsPath = `${process.env.HOME}/.claude/stats-cache.json`;
    const raw = await Bun.file(statsPath).text();
    const stats = JSON.parse(raw) as StatsCache;

    const day = stats.dailyActivity?.find((d) => d.date === dateStr);
    if (!day) return "";

    const tokenDay = stats.dailyModelTokens?.find((d) => d.date === dateStr);
    const byModel = tokenDay
      ? Object.entries(tokenDay.tokensByModel)
          .sort(([, a], [, b]) => b - a)
          .map(
            ([m, c]) =>
              `${m.replace(/claude-|-\d{8,}$/g, "").replace(/-4-\d+$/, "")}: ${c}`,
          )
          .join(", ")
      : "";

    return [
      `${day.messageCount} messages, ${day.sessionCount} sessions, ${day.toolCallCount} tool calls`,
      byModel ? `By model: ${byModel}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

async function getInboxSummary(): Promise<string> {
  try {
    const { getUnreadCount } = await import("../comms/inbox.ts");
    const counts = await getUnreadCount();
    const entries = Object.entries(counts).filter(([, v]) => v > 0);
    if (entries.length === 0) return "No unread messages.";
    return entries.map(([ch, count]) => `- ${ch}: ${count} unread`).join("\n");
  } catch {
    return "";
  }
}

async function getUpcomingCrons(): Promise<string> {
  try {
    const { listCronJobs } = await import("./cron.ts");
    const jobs = await listCronJobs();
    const enabled = jobs.filter((j) => j.enabled).slice(0, 5);
    if (enabled.length === 0) return "No scheduled jobs.";
    return enabled
      .map((j) => `- ${j.name}: ${j.schedule_type} ${j.schedule_value}`)
      .join("\n");
  } catch {
    return "Cron module unavailable.";
  }
}

async function getRevenueSnapshot(): Promise<string> {
  try {
    const { getRevenueSummary } = await import("./revenue.ts");
    const summary = await getRevenueSummary();
    if (summary.totalMRR === 0 && summary.entries.length === 0) return "";
    return `$${summary.totalMRR.toFixed(2)}`;
  } catch {
    return "";
  }
}

async function getYoutubeSnapshot(): Promise<string> {
  const channelId = config.YOUTUBE_CHANNEL_ID;
  if (!channelId || !config.GOOGLE_API_KEY) return "";
  try {
    const { getChannelStats } = await import("../comms/youtube.ts");
    const stats = await getChannelStats(channelId);
    if (!stats) return "";
    return `${Number(stats.subscriberCount).toLocaleString()} subs · ${Number(stats.viewCount).toLocaleString()} views`;
  } catch {
    return "";
  }
}

async function getPillarSummary(): Promise<string> {
  try {
    const { getTodayRatings, getTodayNonNegs, getStreaks } =
      await import("./pillars.ts");
    const [ratings, nonNegs, streaks] = await Promise.all([
      getTodayRatings(),
      getTodayNonNegs(),
      getStreaks(),
    ]);
    if (ratings.length === 0 && nonNegs.length === 0) return "";
    const lines: string[] = [];
    if (ratings.length > 0) {
      ratings.forEach((r) => lines.push(`- ${r.pillar}: ${r.score}/10`));
    }
    if (nonNegs.length > 0) {
      nonNegs.forEach((item) => {
        const streak = streaks.get(item.name) ?? 0;
        const check = item.completed ? "✓" : "○";
        lines.push(
          `- ${check} ${item.name}${streak > 1 ? ` (${streak}d)` : ""}`,
        );
      });
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

async function getWorldIndex(): Promise<string> {
  try {
    const indexPath = resolve(
      homedir(),
      "brain-vault/90 - Agent Memory/State/world-index.yaml",
    );
    return await Bun.file(indexPath).text();
  } catch {
    return "";
  }
}

async function getRoadmapPicks(): Promise<string> {
  if (!config.VISION_ENABLED) return "";
  try {
    const { filterRoadmap } = await import("./vision.ts");
    const roadmapPath = resolve(
      homedir(),
      "brain-vault/90 - Agent Memory/Plans/consolidated-roadmap-2026-02-24.md",
    );
    let items: string[] = [];
    try {
      const raw = await Bun.file(roadmapPath).text();
      items = raw
        .split("\n")
        .filter((l) => l.match(/^[-*]\s+/))
        .map((l) => l.replace(/^[-*]\s+/, "").trim())
        .filter((l) => l.length > 10)
        .slice(0, 20);
    } catch {
      return "";
    }
    if (items.length === 0) return "";
    const ranked = await filterRoadmap(items, 3);
    return ranked.map((r) => `- ${r.score}/10 ${r.description}`).join("\n");
  } catch {
    return "";
  }
}

async function getRecentlyShipped(): Promise<string> {
  try {
    const { formatProvenanceSummary } = await import("../memory/provenance.ts");
    const summary = await formatProvenanceSummary(7);
    return summary || "";
  } catch {
    return "";
  }
}

async function getAINewsFeed(): Promise<string> {
  if (!config.MORNING_BRIEF_NEWS_ENABLED) return "";
  const { text, ok } = await runPrompt({
    system:
      "You are an AI news curator. Generate a brief 3-point summary of the most impactful AI developments from the past 48 hours that a creative technologist would care about. Be specific, not generic. Focus on tools, capabilities, and business implications.",
    prompt: `Today is ${new Date().toLocaleDateString()}. Generate 3 key AI developments.`,
    model: "claude-haiku-4-5-20251001",
  });
  if (!ok || !text) return "";
  return `\n## AI News\n${text}`;
}

async function getFeedbackTriage(): Promise<string> {
  if (!config.MORNING_BRIEF_NEWS_ENABLED) return "";
  try {
    const { getSupabase: getSupa, memoryEnabled: memEnabled } =
      await import("../memory/client.ts");
    if (!memEnabled) return "";
    const { data } = await getSupa()
      .from("judgments")
      .select("id, action, reason, created_at")
      .eq("outcome", "rejected")
      .gte(
        "created_at",
        new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
      )
      .order("created_at", { ascending: false })
      .limit(5);
    if (!data || data.length === 0) return "";
    const items = data
      .map((j) => `- ${j.action}${j.reason ? `: ${j.reason}` : ""}`)
      .join("\n");
    return `\n## Pending Feedback (${data.length} rejected)\n${items}`;
  } catch {
    return "";
  }
}

async function generateBrief(context: string): Promise<string> {
  const { text, ok } = await runPrompt({
    system:
      "You are EDDIE, a chill AI assistant giving a casual morning briefing to Nicholas. Keep it short, warm, and useful — highlight what matters today. 3-5 sentences max. Casual surfer-ish tone but substantive.",
    prompt: context,
    model: "claude-haiku-4-5-20251001",
  });
  if (!ok) return context;
  return text;
}

export async function buildBriefText(): Promise<string> {
  const now = new Date().toLocaleString("en-US", {
    timeZone: config.TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const [
    goals,
    activity,
    crons,
    usageStats,
    inbox,
    pillarData,
    youtube,
    revenue,
    worldModel,
    recentlyShipped,
    roadmapPicks,
    aiNews,
    feedbackTriage,
  ] = await Promise.all([
    getActiveGoals(),
    getYesterdayActivity(),
    getUpcomingCrons(),
    getYesterdayUsageStats().catch(() => ""),
    getInboxSummary(),
    getPillarSummary().catch(() => ""),
    getYoutubeSnapshot().catch(() => ""),
    getRevenueSnapshot().catch(() => ""),
    getWorldIndex().catch(() => ""),
    getRecentlyShipped().catch(() => ""),
    getRoadmapPicks().catch(() => ""),
    getAINewsFeed().catch(() => ""),
    getFeedbackTriage().catch(() => ""),
  ]);

  const context = [
    `Good morning! It's ${now}.`,
    "",
    "## Active Goals",
    goals,
    "",
    "## Yesterday's Activity",
    activity,
    "",
    "## Scheduled Jobs",
    crons,
    inbox ? `\n## Inbox\n${inbox}` : "",
    usageStats ? `\n## Claude Usage (Yesterday)\n${usageStats}` : "",
    pillarData ? `\n## Yesterday's Pillars\n${pillarData}` : "",
    youtube ? `\n## YouTube\n${youtube}` : "",
    revenue ? `\n## Revenue (30d)\n${revenue}` : "",
    recentlyShipped ? `\n## Recently Shipped\n${recentlyShipped}` : "",
    worldModel ? `\n## Project Pulse\n${worldModel}` : "",
    roadmapPicks ? `\n## Roadmap Picks\n${roadmapPicks}` : "",
    aiNews || "",
    feedbackTriage || "",
  ]
    .filter(Boolean)
    .join("\n");

  return generateBrief(context);
}

export async function runMorningBrief(bot: Bot): Promise<void> {
  logger.info("morning-brief:start");
  if (config.GATHER_BEFORE_BRIEF) {
    const { gatherFreshData } = await import("./gather.ts");
    const gathered = await gatherFreshData().catch(() => null);
    if (gathered) {
      logger.info("morning-brief:gathered", {
        gmail: gathered.gmailCount,
        calendar: gathered.calendarCount,
      });
    }
  }
  const brief = await buildBriefText();
  await bot.api.sendMessage({
    chat_id: config.OWNER_TELEGRAM_ID,
    text: brief,
  });
  logger.info("morning-brief:sent");
}

export function startMorningBrief(bot: Bot, time = "08:00"): void {
  const { hour, minute } = parseTime(time);
  const delay = msUntilTime(hour, minute, config.TIMEZONE);
  logger.info("morning-brief:scheduled", { time, delayMs: delay });

  const handleBriefError = (err: unknown): void => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("morning-brief:error", { error: errorMsg });
    import("../jobs/self-heal.ts")
      .then(({ triggerSelfHeal }) =>
        triggerSelfHeal(
          {
            source: "morning-brief",
            name: "run",
            error: errorMsg,
            timestamp: Date.now(),
          },
          bot,
        ),
      )
      .catch(() => {});
  };

  setTimeout(() => {
    runMorningBrief(bot).catch(handleBriefError);
    setInterval(
      () => {
        runMorningBrief(bot).catch(handleBriefError);
      },
      24 * 60 * 60 * 1000,
    );
  }, delay);
}
