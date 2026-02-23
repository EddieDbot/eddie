import { config } from "../config.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { storeFact } from "../memory/store.ts";
import { searchMemory } from "../memory/search.ts";
import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";
import { homedir } from "node:os";

const BRAIN_VAULT = resolve(homedir(), "brain-vault");

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hour: h ?? 2, minute: m ?? 0 };
}

function msUntilTime(hour: number, minute: number, timezone: string): number {
  const now = new Date();
  const nowLocal = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const target = new Date(nowLocal);
  target.setHours(hour, minute, 0, 0);
  if (target <= nowLocal) target.setDate(target.getDate() + 1);
  return target.getTime() - nowLocal.getTime();
}

async function getYesterdayConversations(limit = 200): Promise<string> {
  if (!memoryEnabled) return "No conversations available.";
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await getSupabase()
      .from("conversations")
      .select("role, content, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (!data || data.length === 0) return "No conversations in the past 24 hours.";
    return data.map((c) => `[${c.role}]: ${c.content.slice(0, 300)}`).join("\n");
  } catch {
    return "Could not fetch conversations.";
  }
}

async function extractLearnings(conversations: string): Promise<string[]> {
  if (!config.ANTHROPIC_API_KEY) return [];

  const system = `You are EDDIE's dream cycle processor. Analyze today's conversations and extract valuable insights worth remembering long-term.

Extract 3-7 atomic insights as a JSON array of strings. Each insight should be:
- A clear, third-person statement (e.g. "Nicholas prefers TypeScript functional style over OOP")
- Specific and actionable, not generic
- Something worth remembering across sessions

Respond with ONLY a JSON array: ["insight 1", "insight 2", ...]
If there are no valuable insights, return [].`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: `Today's conversations:\n${conversations}` }],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) return [];
    const data = (await res.json()) as { content: { type: string; text: string }[] };
    const text = data.content.find((c) => c.type === "text")?.text ?? "[]";
    return JSON.parse(text.trim()) as string[];
  } catch {
    return [];
  }
}

async function deduplicateInsights(insights: string[]): Promise<string[]> {
  if (!memoryEnabled) return insights;
  const novel: string[] = [];
  for (const insight of insights) {
    try {
      const results = await searchMemory(insight, 3, 0.85);
      if (results.length === 0) {
        novel.push(insight);
      } else {
        logger.debug("dream:duplicate-skipped", { insight: insight.slice(0, 50) });
      }
    } catch {
      novel.push(insight);
    }
  }
  return novel;
}

async function cleanStaleHourlyFacts(): Promise<void> {
  if (!memoryEnabled) return;
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    await getSupabase()
      .from("facts")
      .update({ active: false })
      .eq("source", "hourly-state")
      .lt("created_at", cutoff);
  } catch (err) {
    logger.warn("dream:stale-cleanup-failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

async function writeJournal(date: string, conversations: string, insights: string[], stored: string[]): Promise<void> {
  const dir = resolve(BRAIN_VAULT, "90 - Agent Memory/Learnings");
  const path = resolve(dir, `${date}-eddie-journal.md`);
  const content = [
    `# EDDIE Dream Journal — ${date}`,
    "",
    `**Generated:** ${new Date().toISOString()}`,
    `**Conversations processed:** ${conversations.split("\n").length} lines`,
    `**Novel insights stored:** ${stored.length}/${insights.length}`,
    "",
    "## Insights Extracted",
    ...insights.map((i, n) => `${n + 1}. ${i}`),
    "",
    "## Stored to Memory",
    stored.length > 0 ? stored.map((i) => `- ${i}`).join("\n") : "_All insights were duplicates_",
  ].join("\n");

  try {
    await Bun.write(path, content);
    logger.info("dream:journal-written", { path });
  } catch (err) {
    logger.error("dream:journal-write-failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

export async function runDreamCycle(): Promise<void> {
  logger.info("dream:cycle-start");
  const conversations = await getYesterdayConversations();
  const insights = await extractLearnings(conversations);

  if (insights.length === 0) {
    logger.info("dream:no-insights");
    await cleanStaleHourlyFacts();
    return;
  }

  const novel = await deduplicateInsights(insights);

  for (const insight of novel) {
    await storeFact(insight, "learning", "dream-cycle");
  }

  const date = new Date().toISOString().split("T")[0]!;
  await writeJournal(date, conversations, insights, novel);
  await cleanStaleHourlyFacts();

  logger.info("dream:cycle-done", { total: insights.length, stored: novel.length });
}

export function startDreamCycle(time = "02:00"): void {
  const { hour, minute } = parseTime(time);
  const delay = msUntilTime(hour, minute, config.TIMEZONE);
  logger.info("dream:scheduled", { time, delayMs: delay });

  setTimeout(() => {
    runDreamCycle().catch((err) =>
      logger.error("dream:cycle-error", { error: err instanceof Error ? err.message : String(err) }),
    );
    setInterval(() => {
      runDreamCycle().catch((err) =>
        logger.error("dream:cycle-error", { error: err instanceof Error ? err.message : String(err) }),
      );
    }, 24 * 60 * 60 * 1000);
  }, delay);
}
