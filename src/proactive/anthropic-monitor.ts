import { resolve } from "node:path";
import type { Bot } from "gramio";
import { STATE_DIR, AREAS_DIR } from "../memory/brain-vault-paths.ts";
import { logger } from "../utils/logger.ts";
import { config } from "../config.ts";

const STATE_FILE = resolve(STATE_DIR, "anthropic-monitor-state.json");
const UPDATES_FILE = resolve(AREAS_DIR, "AI Research", "anthropic-updates.md");

interface MonitorState {
  githubLatestReleaseId: string;
  changelogLeadHash: string;
  releaseNotesLeadHash: string;
  anthropicNewsLatestTitle: string;
  lastChecked: string;
}

interface GithubRelease {
  id: string;
  title: string;
  link: string;
  updated: string;
  summary: string;
}

async function loadState(): Promise<MonitorState> {
  try {
    return JSON.parse(await Bun.file(STATE_FILE).text());
  } catch {
    return {
      githubLatestReleaseId: "",
      changelogLeadHash: "",
      releaseNotesLeadHash: "",
      anthropicNewsLatestTitle: "",
      lastChecked: "",
    };
  }
}

async function saveState(state: MonitorState): Promise<void> {
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "EDDIE-monitor/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchGithubReleases(): Promise<GithubRelease[]> {
  const xml = await fetchWithTimeout(
    "https://github.com/anthropics/claude-code/releases.atom",
  );
  const entries: GithubRelease[] = [];

  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = match[1]!;
    const id = e.match(/<id>([^<]+)<\/id>/)?.[1] ?? "";
    const title = e.match(/<title[^>]*>([^<]+)<\/title>/)?.[1]?.trim() ?? "";
    const link = e.match(/<link[^>]+href="([^"]+)"/)?.[1] ?? "";
    const updated = e.match(/<updated>([^<]+)<\/updated>/)?.[1] ?? "";
    const summary = stripHtml(
      e.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? "",
    ).slice(0, 400);
    if (id && title) entries.push({ id, title, link, updated, summary });
  }

  return entries;
}

async function fetchChangelogLead(): Promise<string> {
  const text = await fetchWithTimeout(
    "https://code.claude.com/docs/en/changelog.md",
  ).catch(() => fetchWithTimeout("https://code.claude.com/docs/en/changelog"));
  // First 800 chars captures the most recent entry header + content
  return text.slice(0, 800).trim();
}

// Scrape Anthropic news — extract article titles from Next.js __NEXT_DATA__ or og:title tags
async function fetchAnthropicNewsLatestTitle(): Promise<string> {
  const html = await fetchWithTimeout("https://www.anthropic.com/news");
  // Next.js embeds page data in __NEXT_DATA__ JSON
  const nextDataMatch = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]!);
      // Navigate the props tree to find article titles
      const posts =
        data?.props?.pageProps?.posts ?? data?.props?.pageProps?.articles ?? [];
      if (Array.isArray(posts) && posts.length > 0) {
        return posts[0]?.title ?? posts[0]?.heading ?? "";
      }
    } catch {}
  }
  // Fallback: grab first <h3> or <h2> that looks like an article title
  const titleMatch = html.match(/<h[23][^>]*>([^<]{10,120})<\/h[23]>/);
  return titleMatch?.[1]?.trim() ?? "";
}

async function fetchReleaseNotesLead(): Promise<string> {
  const html = await fetchWithTimeout(
    "https://platform.claude.com/docs/en/release-notes/overview",
  );
  return stripHtml(html).slice(0, 1500);
}

async function appendToBrainVault(content: string): Promise<void> {
  const file = Bun.file(UPDATES_FILE);
  const header = "# Anthropic Updates\n\n";
  const existing = (await file.exists()) ? await file.text() : header;
  await Bun.write(UPDATES_FILE, existing + content + "\n");
}

export async function checkAnthropicUpdates(bot: Bot): Promise<void> {
  const state = await loadState();
  const updates: string[] = [];
  const newState: MonitorState = {
    ...state,
    lastChecked: new Date().toISOString(),
  };

  // 1. GitHub Releases (machine-readable Atom feed)
  try {
    const releases = await fetchGithubReleases();
    const latest = releases[0];
    if (latest && latest.id !== state.githubLatestReleaseId) {
      const lastIdx = releases.findIndex(
        (r) => r.id === state.githubLatestReleaseId,
      );
      const newOnes =
        lastIdx === -1 ? releases.slice(0, 3) : releases.slice(0, lastIdx);
      for (const r of newOnes.slice(0, 5)) {
        updates.push(
          `🚀 *Claude Code ${r.title}*\n${r.link}${r.summary ? `\n\n${r.summary}` : ""}`,
        );
      }
      newState.githubLatestReleaseId = latest.id;
    }
  } catch (err) {
    logger.warn("anthropic-monitor:github", { error: String(err) });
  }

  // 2. Claude Code changelog docs
  try {
    const lead = await fetchChangelogLead();
    const leadHash = Bun.hash(lead).toString();
    if (leadHash !== state.changelogLeadHash) {
      const firstHeader =
        lead
          .split("\n")
          .find((l) => l.startsWith("#"))
          ?.trim() ?? "updated";
      updates.push(
        `📝 *Claude Code Docs — ${firstHeader}*\nhttps://code.claude.com/docs/en/changelog`,
      );
      newState.changelogLeadHash = leadHash;
    }
  } catch (err) {
    logger.warn("anthropic-monitor:changelog", { error: String(err) });
  }

  // 3. Anthropic platform release notes
  try {
    const lead = await fetchReleaseNotesLead();
    const leadHash = Bun.hash(lead).toString();
    if (leadHash !== state.releaseNotesLeadHash) {
      updates.push(
        `📢 *Anthropic Platform Release Notes updated*\nhttps://platform.claude.com/docs/en/release-notes/overview`,
      );
      newState.releaseNotesLeadHash = leadHash;
    }
  } catch (err) {
    logger.warn("anthropic-monitor:release-notes", { error: String(err) });
  }

  // 4. Anthropic News (model launches, major announcements)
  try {
    const title = await fetchAnthropicNewsLatestTitle();
    if (title && title !== state.anthropicNewsLatestTitle) {
      updates.push(
        `📰 *Anthropic News: ${title}*\nhttps://www.anthropic.com/news`,
      );
      newState.anthropicNewsLatestTitle = title;
    }
  } catch (err) {
    logger.warn("anthropic-monitor:news", { error: String(err) });
  }

  if (updates.length > 0) {
    const message = `🔔 *Anthropic Updates*\n\n${updates.join("\n\n─────\n\n")}`;
    try {
      await bot.api.sendMessage({
        chat_id: config.OWNER_TELEGRAM_ID,
        text: message,
        parse_mode: "Markdown",
      });
    } catch (err) {
      logger.warn("anthropic-monitor:telegram", { error: String(err) });
    }

    const date = new Date().toLocaleDateString("sv", {
      timeZone: config.TIMEZONE,
    });
    const mdEntry = `## ${date}\n\n${updates.map((u) => u.replace(/\*/g, "")).join("\n\n")}\n`;
    await appendToBrainVault(mdEntry).catch(() => {});
  }

  await saveState(newState);
  logger.info("anthropic-monitor:checked", { updates: updates.length });
}

// Returns current hour (0-23) in Nicholas's timezone
function currentHourCST(): number {
  return parseInt(
    new Date().toLocaleString("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: config.TIMEZONE,
    }),
    10,
  );
}

// ms until the top of the next hour
function msUntilNextHour(): number {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next.getTime() - now.getTime();
}

export function startAnthropicMonitor(bot: Bot): void {
  const WAKE_START = 8; // 8 AM CST
  const WAKE_END = 24; // midnight CST

  const run = () =>
    checkAnthropicUpdates(bot).catch((err) =>
      logger.warn("anthropic-monitor:error", { error: String(err) }),
    );

  function scheduleNextHour(): void {
    setTimeout(() => {
      const hour = currentHourCST();
      if (hour >= WAKE_START && hour < WAKE_END) run();
      scheduleNextHour();
    }, msUntilNextHour());
  }

  // Run once at startup if currently in waking hours
  const startHour = currentHourCST();
  if (startHour >= WAKE_START && startHour < WAKE_END) {
    setTimeout(run, 30_000);
  }

  scheduleNextHour();
  logger.info("anthropic-monitor:started", {
    schedule: "hourly 8am–midnight CST",
  });
}
