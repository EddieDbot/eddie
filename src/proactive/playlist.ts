import type { Bot } from "gramio";
import { homedir } from "node:os";
import { createJob } from "../jobs/manager.ts";
import { spawnJob } from "../jobs/tmux.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

const HOME = homedir();
const BRAIN_VAULT = `${HOME}/brain-vault`;
const PLAYLISTS_CONFIG = `${BRAIN_VAULT}/00 - Inbox/transcripts/playlists.json`;
const PROCESSED_LOG = `${BRAIN_VAULT}/00 - Inbox/transcripts/processed-videos.txt`;
const PLANS_DIR = `${BRAIN_VAULT}/90 - Agent Memory/Plans`;

export type PlaylistEntry = {
  name: string;
  url: string;
  project_hint?: string;
  enabled: boolean;
};

type PlaylistsConfig = {
  playlists: PlaylistEntry[];
};

function extractPlaylistId(url: string): string | null {
  const match = url.match(/[?&]list=([^&]+)/);
  return match ? match[1]! : null;
}

async function loadProcessed(): Promise<Set<string>> {
  try {
    const text = await Bun.file(PROCESSED_LOG).text();
    const ids = new Set<string>();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      ids.add(trimmed.split("|")[0]!.trim());
    }
    return ids;
  } catch {
    return new Set();
  }
}

async function markProcessed(videoId: string, title: string): Promise<void> {
  const entry = `${videoId}|${title}|${new Date().toISOString()}\n`;
  const existing = await Bun.file(PROCESSED_LOG)
    .text()
    .catch(() => "");
  await Bun.write(PROCESSED_LOG, existing + entry);
}

async function fetchPlaylistItems(
  playlistId: string,
): Promise<Array<{ videoId: string; title: string }>> {
  const apiKey = config.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  const results: Array<{ videoId: string; title: string }> = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      part: "snippet",
      playlistId,
      maxResults: "50",
      key: apiKey,
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?${params}`,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("playlist:fetch-failed", {
        playlistId,
        status: res.status,
        body: body.slice(0, 200),
      });
      break;
    }
    const data = (await res.json()) as {
      items?: Array<{
        snippet: { resourceId: { videoId: string }; title: string };
      }>;
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) {
      results.push({
        videoId: item.snippet.resourceId.videoId,
        title: item.snippet.title,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return results;
}

function buildJobPrompt(
  videoId: string,
  title: string,
  playlistName: string,
): string {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const date = new Date().toISOString().split("T")[0];
  const reportPath = `${PLANS_DIR}/playlist-${date}-${videoId}.md`;

  return `## Playlist Ingestion: ${title}

**Video:** ${videoUrl}
**Playlist:** ${playlistName}
**Report path:** ${reportPath}

## Step 1: Ingest Transcript

Use the transcript-ingester agent to process this URL: ${videoUrl}

The agent will fetch the transcript, extract deep insights, match against project manifests, and route the pre-digested file to the correct Brain Vault project folder.

## Step 2: Find the Extraction File

After the transcript-ingester completes, locate the file it wrote. Check:
- ~/brain-vault/10 - Projects/EDDIE-Upgrades/notes/transcripts/_staging/
- ~/brain-vault/10 - Projects/eddie/notes/transcripts/_staging/
- ~/brain-vault/10 - Projects/*/notes/transcripts/_staging/

Find the most recently modified .md file — that's the extraction output.

## Step 3: Comparison Analysis

Read the extraction file fully. Then read both reference documents:
1. ~/brain-vault/90 - Agent Memory/State/eddie-current.md — EDDIE's current implemented state
2. ~/brain-vault/10 - Projects/EDDIE-Upgrades/EDDIE-UPGRADE-REPORT.md — the existing analyzed backlog

For EACH distinct technique, pattern, tool, or feature idea in the extraction, assign one verdict:

- **HAVE_IT** — Already implemented in EDDIE. Cite exactly where/how.
- **IN_BACKLOG** — Already analyzed in the upgrade report. Cite the section and current priority.
- **IMPROVE** — We have something similar but this suggests a specific, concrete enhancement. State exactly what to change and why.
- **NET_NEW** — Genuinely new idea. Not in the system, not in the backlog. Describe a realistic implementation path with specific files/modules.
- **SKIP** — Objectively worse than what we have, not applicable to our stack, or violates our TypeScript/functional/homelab principles. State the reason concisely.

Be rigorous:
- Do NOT mark something NET_NEW if it's already in the upgrade backlog.
- Do NOT mark something HAVE_IT unless it's actually implemented, not just planned.
- Do NOT mark something IMPROVE if we'd be better off with a full NET_NEW implementation.
- If something is covered by an existing SKIP decision, mark SKIP and reference it.

## Step 4: Write Report

Write the full comparison report to: ${reportPath}

Use this exact format:

\`\`\`markdown
# Playlist Ingestion: ${title}
**Date:** ${date}
**Source:** ${playlistName}
**Video:** ${videoUrl}

## Verdicts

### NET_NEW (N ideas)
- **[Idea name]** — Description + implementation path (files, approach)
...

### IMPROVE (N ideas)
- **[Feature name]** — What we have now → what to change and why
...

### IN_BACKLOG (N ideas)
- **[Idea name]** — Already in EDDIE-UPGRADE-REPORT.md § [section], priority [X]
...

### HAVE_IT (N ideas)
- **[Feature name]** — Implemented in [file/module]
...

### SKIP (N ideas)
- **[Idea name]** — [Reason: worse than X / not applicable / stack mismatch]
...

## Summary
Overall assessment of this video's value. Top 1–2 actionable picks from NET_NEW or IMPROVE, with a one-sentence rationale for each.
\`\`\`

## Step 5: Final Output

End your response with this exact line (fill in the counts):
PLAYLIST_REPORT: ${title} | net_new=N | improve=N | in_backlog=N | have_it=N | skip=N | ${reportPath}
`;
}

export async function checkPlaylists(): Promise<{
  spawned: number;
  checked: number;
}> {
  if (!config.YOUTUBE_API_KEY) {
    logger.warn("playlist:disabled — YOUTUBE_API_KEY not set");
    return { spawned: 0, checked: 0 };
  }

  let configData: PlaylistsConfig;
  try {
    configData = await Bun.file(PLAYLISTS_CONFIG).json();
  } catch {
    logger.warn("playlist:config-not-found", { path: PLAYLISTS_CONFIG });
    return { spawned: 0, checked: 0 };
  }

  const enabled = configData.playlists.filter((p) => p.enabled);
  if (enabled.length === 0) return { spawned: 0, checked: enabled.length };

  const processed = await loadProcessed();
  let spawned = 0;

  for (const playlist of enabled) {
    const playlistId = extractPlaylistId(playlist.url);
    if (!playlistId) {
      logger.warn("playlist:invalid-url", {
        name: playlist.name,
        url: playlist.url,
      });
      continue;
    }

    const items = await fetchPlaylistItems(playlistId);
    const newItems = items.filter((item) => !processed.has(item.videoId));

    for (const item of newItems) {
      logger.info("playlist:new-video", {
        title: item.title,
        videoId: item.videoId,
        playlist: playlist.name,
      });

      // Mark processed immediately — avoids double-spawn if job fails partway
      await markProcessed(item.videoId, item.title);

      const prompt = buildJobPrompt(item.videoId, item.title, playlist.name);
      const job = await createJob("claude", prompt);
      await spawnJob(job);
      spawned++;
    }

    logger.info("playlist:checked", {
      name: playlist.name,
      total: items.length,
      new: newItems.length,
    });
  }

  return { spawned, checked: enabled.length };
}

export async function loadPlaylistsConfig(): Promise<PlaylistsConfig> {
  try {
    return await Bun.file(PLAYLISTS_CONFIG).json();
  } catch {
    return { playlists: [] };
  }
}

export async function savePlaylistsConfig(
  data: PlaylistsConfig,
): Promise<void> {
  await Bun.write(PLAYLISTS_CONFIG, JSON.stringify(data, null, 2));
}

export async function getRecentReports(
  limit = 5,
): Promise<Array<{ name: string; path: string; summary: string }>> {
  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(PLANS_DIR);
    const playlistFiles = files
      .filter((f) => f.startsWith("playlist-") && f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, limit);

    const reports: Array<{ name: string; path: string; summary: string }> = [];
    for (const file of playlistFiles) {
      const path = `${PLANS_DIR}/${file}`;
      const content = await Bun.file(path)
        .text()
        .catch(() => "");
      // Extract title from first heading
      const titleMatch = content.match(/^# Playlist Ingestion: (.+)$/m);
      const title = titleMatch ? titleMatch[1]! : file;
      // Extract summary section
      const summaryMatch = content.match(/## Summary\n([\s\S]+?)(?:\n##|$)/);
      const summary = summaryMatch ? summaryMatch[1]!.trim().slice(0, 200) : "";
      reports.push({ name: title, path, summary });
    }
    return reports;
  } catch {
    return [];
  }
}

export function startPlaylistWatcher(bot: Bot): void {
  if (!config.YOUTUBE_API_KEY || !config.PLAYLIST_ENABLED) {
    logger.info("playlist:watcher-disabled");
    return;
  }

  const now = new Date();
  const msUntilNextHour =
    (60 - now.getMinutes()) * 60_000 -
    now.getSeconds() * 1_000 -
    now.getMilliseconds();

  logger.info("playlist:watcher-started", {
    nextCheckIn: `${Math.round(msUntilNextHour / 60_000)}min`,
  });

  setTimeout(() => {
    checkPlaylists().catch((err) => logger.error("playlist:check-error", err));
    setInterval(() => {
      checkPlaylists().catch((err) =>
        logger.error("playlist:check-error", err),
      );
    }, 3_600_000);
  }, msUntilNextHour);
}
