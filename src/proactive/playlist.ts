import type { Bot } from "gramio";
import { homedir } from "node:os";
import { BRAIN_VAULT_ROOT, PLANS_DIR as BV_PLANS_DIR, INBOX_DIR, getTranscriptDir } from "../memory/brain-vault-paths.ts";
import { createJob } from "../jobs/manager.ts";
import { spawnJob } from "../jobs/tmux.ts";
import { logProvenance } from "../memory/provenance.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

const HOME = homedir();
const PLAYLISTS_CONFIG = `${INBOX_DIR}/transcripts/playlists.json`;
const PROCESSED_LOG = `${INBOX_DIR}/transcripts/processed-videos.txt`;
const RAW_BUCKET = `${INBOX_DIR}/transcripts/_raw`;
const UNUSED_DIR = `${INBOX_DIR}/transcripts/_unused`;
const PLANS_DIR = BV_PLANS_DIR;
const PLAYLIST_MANAGER = `${HOME}/.claude/scripts/playlist-manager.py`;
const DIGESTED_PLAYLIST_URL =
  "https://youtube.com/playlist?list=PLgSl4exmSE0kXhDdqcYE5vmjaxamTh-bL";

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

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
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
  playlistUrl: string,
): string {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const date = new Date().toISOString().split("T")[0];
  const slug = slugify(title);
  const rawPath = `${RAW_BUCKET}/${date}-${videoId}-${slug}.md`;
  const reportPath = `${PLANS_DIR}/playlist-${date}-${videoId}.md`;

  return `## Playlist Ingestion: ${title}

**Video:** ${videoUrl}
**Playlist:** ${playlistName}
**Raw bucket:** ${rawPath}
**Report path:** ${reportPath}

---

## Step 1: Fetch Transcript → Save to Bucket

Use the transcript-ingester agent to fetch the transcript for: ${videoUrl}

After the agent fetches the transcript, save the RAW transcript text (unprocessed, full verbatim content) to:
${rawPath}

Format the raw file as:
\`\`\`markdown
# ${title}
**Video:** ${videoUrl}
**Fetched:** ${date}
**Playlist:** ${playlistName}

---

[full transcript text here]
\`\`\`

## Step 2: Move to Digested Playlist

Once the raw transcript is saved to the bucket, immediately move the video from the source playlist to the EDDIE Digested playlist.

Run:
\`\`\`bash
python3 ${PLAYLIST_MANAGER} move "${playlistUrl}" "${DIGESTED_PLAYLIST_URL}" "${videoId}"
\`\`\`

If this fails (credentials not set up), log the failure and continue — do not abort.

## Step 3: Deep Extraction + Routing

Check the file size of ${rawPath} in kilobytes.

**If < 50KB:** Run transcript-ingester agent on ${rawPath} directly (single agent).

**If ≥ 50KB:** Split the work — spawn TWO agents in parallel using the Task tool:
- Agent A: Run transcript-ingester on ${rawPath} for extraction + routing
- Agent B: Begin reading eddie-current.md and EDDIE-UPGRADE-REPORT.md to prepare for comparison (Step 4)

Wait for both agents to finish before proceeding.

The transcript-ingester agent will:
- Extract deep insights using standard + role-forge extraction modes
- Score against all project manifests in Brain Vault
- Route the pre-digested extraction to the best-matching project staging folder

## Step 4: Comparison Analysis

Read the extraction file the agent just wrote. Then read both reference documents:
1. ~/brain-vault/90 - Agent Memory/State/eddie-current.md — EDDIE's current implemented state
2. ~/brain-vault/10 - Projects/EDDIE-Upgrades/EDDIE-UPGRADE-REPORT.md — existing analyzed backlog

For EACH distinct technique, pattern, tool, or feature idea, assign one verdict:

- **HAVE_IT** — Already implemented in EDDIE. Cite exactly where/how.
- **IN_BACKLOG** — Already in upgrade report. Cite section + priority.
- **IMPROVE** — We have something similar, this suggests a specific enhancement. State what to change.
- **NET_NEW** — Genuinely new. Describe implementation path with specific files/modules.
- **SKIP** — Objectively worse, not applicable, or violates our stack/principles. State why.

Rules:
- Do NOT mark NET_NEW if already in backlog.
- Do NOT mark HAVE_IT unless actually implemented, not just planned.
- Do NOT mark IMPROVE if a full NET_NEW replacement is better.

## Step 5: Write Comparison Report

Write to: ${reportPath}

\`\`\`markdown
# Playlist Ingestion: ${title}
**Date:** ${date}
**Source:** ${playlistName}
**Video:** ${videoUrl}
**Raw transcript:** ${rawPath}
**Routed to:** [project name(s) the transcript-ingester chose]

## Verdicts

### NET_NEW (N)
- **[Idea]** — Description + implementation path

### IMPROVE (N)
- **[Feature]** — Current state → what to change + why

### IN_BACKLOG (N)
- **[Idea]** — EDDIE-UPGRADE-REPORT.md § [section]

### HAVE_IT (N)
- **[Feature]** — [file/module]

### SKIP (N)
- **[Idea]** — [reason]

## Routing Decision
**Project routed to:** [project slug the transcript-ingester chose]
**Confidence:** [score]
**Action taken:** [ROUTED | ARCHIVED]

## Summary
Overall value of this video. Top 1–2 actionable picks.
\`\`\`

## Step 6: Auto-Route the Raw Transcript

Based on the transcript-ingester's routing decision and confidence score:

- **Score ≥ 50:** Move the raw transcript file from the bucket to the matched project:
  \`\`\`bash
  mv "${rawPath}" "${BRAIN_VAULT_ROOT}/10 - Projects/[project-slug]/notes/transcripts/[filename]"
  \`\`\`
  Create the destination directory first if it doesn't exist (mkdir -p).

- **Score < 50 or no clear match:** Move to unused archive:
  \`\`\`bash
  mv "${rawPath}" "${UNUSED_DIR}/[filename]"
  \`\`\`

Record what you did in the "Routing Decision" section of the report.

## Step 6b: Vector Memory Push

After routing the transcript, push the top insights to EDDIE's vector memory.

For the top 5 NET_NEW and IMPROVE insights from your extraction:
\`\`\`bash
echo "<insight description>" | bun run ~/eddie/src/scripts/store-fact-cli.ts --category learning --source "playlist:${videoId}"
\`\`\`

For each unique framework introduced (up to 3):
\`\`\`bash
echo "<framework_name>: <description>. Application: <how to use it>" | bun run ~/eddie/src/scripts/store-fact-cli.ts --category learning --source "playlist:${videoId}"
\`\`\`

If \`bun run\` fails, log and continue — vector push is best-effort.

## Step 7: Final Output

End your response with this exact line:
PLAYLIST_REPORT: ${title} | net_new=N | improve=N | in_backlog=N | have_it=N | skip=N | routed=[project or archived] | ${reportPath}
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
  const spawning = new Set<string>(); // in-memory guard against double-spawn in same run
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
    const newItems = items.filter(
      (item) => !processed.has(item.videoId) && !spawning.has(item.videoId),
    );

    // Spawn with concurrency cap of 3 — mark processed only after successful spawn
    const CONCURRENCY = 3;
    for (let i = 0; i < newItems.length; i += CONCURRENCY) {
      const batch = newItems.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (item) => {
          spawning.add(item.videoId);
          logger.info("playlist:new-video", {
            title: item.title,
            videoId: item.videoId,
            playlist: playlist.name,
          });
          const prompt = buildJobPrompt(
            item.videoId,
            item.title,
            playlist.name,
            playlist.url,
          );
          const job = await createJob("claude", prompt);
          await spawnJob(job);
          await markProcessed(item.videoId, item.title);
          logProvenance({
            feature_name: item.title,
            source_type: "video",
            source_ref: item.videoId,
            source_title: item.title,
            job_id: job.id,
            status: "in_progress",
          }).catch(() => {});
          spawned++;
        }),
      );
    }

    logger.info("playlist:checked", {
      name: playlist.name,
      total: items.length,
      new: newItems.length,
    });
  }

  if (spawned > 0) {
    import("./report-synthesis.ts")
      .then(({ scheduleSynthesis }) => scheduleSynthesis())
      .catch(() => {});
  }

  return { spawned, checked: enabled.length };
}

// Move raw transcript from bucket to a project folder (Nicholas approves routing)
export async function routeTranscript(
  videoId: string,
  projectSlug: string,
): Promise<
  { ok: boolean; from: string; to: string } | { ok: false; error: string }
> {
  try {
    const { readdir } = await import("node:fs/promises");
    const { rename, mkdir } = await import("node:fs/promises");

    const files = await readdir(RAW_BUCKET);
    const match = files.find((f) => f.includes(videoId));
    if (!match)
      return { ok: false, error: `No raw transcript found for ${videoId}` };

    const from = `${RAW_BUCKET}/${match}`;
    const destDir = getTranscriptDir(projectSlug);
    await mkdir(destDir, { recursive: true });
    const to = `${destDir}/${match}`;
    await rename(from, to);
    return { ok: true, from, to };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Move raw transcript to unused archive
export async function archiveTranscript(
  videoId: string,
): Promise<{ ok: boolean; path: string } | { ok: false; error: string }> {
  try {
    const { readdir, rename, mkdir } = await import("node:fs/promises");

    const files = await readdir(RAW_BUCKET);
    const match = files.find((f) => f.includes(videoId));
    if (!match)
      return { ok: false, error: `No raw transcript found for ${videoId}` };

    await mkdir(UNUSED_DIR, { recursive: true });
    const from = `${RAW_BUCKET}/${match}`;
    const to = `${UNUSED_DIR}/${match}`;
    await (await import("node:fs/promises")).rename(from, to);
    return { ok: true, path: to };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function listBucket(): Promise<
  Array<{ videoId: string; filename: string }>
> {
  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(RAW_BUCKET);
    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        // filename: YYYY-MM-DD-{videoId}-{slug}.md
        const parts = f.replace(/\.md$/, "").split("-");
        // date is parts 0-2, videoId is parts 3
        const videoId = parts[3] ?? f;
        return { videoId, filename: f };
      });
  } catch {
    return [];
  }
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
      const titleMatch = content.match(/^# Playlist Ingestion: (.+)$/m);
      const title = titleMatch ? titleMatch[1]! : file;
      const summaryMatch = content.match(/## Summary\n([\s\S]+?)(?:\n##|$)/);
      const summary = summaryMatch ? summaryMatch[1]!.trim().slice(0, 200) : "";
      reports.push({ name: title, path, summary });
    }
    return reports;
  } catch {
    return [];
  }
}

export type ReportMeta = {
  filename: string;
  date: string;
  videoId: string;
  title: string;
  videoUrl: string | null;
  routedTo: string | null;
  confidence: number | null;
  verdicts: Record<string, number>;
};

function parseReportMeta(filename: string, content: string): ReportMeta {
  const fnMatch = filename.match(/^playlist-(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
  const date = fnMatch ? fnMatch[1]! : "";
  const videoId = fnMatch ? fnMatch[2]! : filename;

  const titleMatch = content.match(
    /^# Playlist Ingestion(?:: | Report — )(.+)$/m,
  );
  const title = titleMatch ? titleMatch[1]!.trim() : filename;

  const urlMatch = content.match(
    /^\*\*(?:Video|URL):\*\*\s*(https:\/\/[^\s]+)/m,
  );
  const videoUrl = urlMatch ? urlMatch[1]! : null;

  const routeMatch = content.match(
    /^\*\*(?:Routed [Tt]o|Primary route):\*\*\s*(.+)$/m,
  );
  const routedTo = routeMatch ? routeMatch[1]!.trim() : null;

  const confMatch = content.match(/^\*\*Confidence:\*\*\s*(\d+)/m);
  const confidence = confMatch ? parseInt(confMatch[1]!) : null;

  const verdicts: Record<string, number> = {};
  const headerRe = /^### (NET_NEW|IMPROVE|IN_BACKLOG|HAVE_IT|SKIP) \((\d+)\)/gm;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(content)) !== null) {
    verdicts[m[1]!] = parseInt(m[2]!);
  }

  // Fallback: count bullets under each section
  if (Object.keys(verdicts).length === 0) {
    for (const label of [
      "NET_NEW",
      "IMPROVE",
      "IN_BACKLOG",
      "HAVE_IT",
      "SKIP",
    ]) {
      const sectionRe = new RegExp(
        `## ${label} Items?\\n([\\s\\S]+?)(?:\\n##|$)`,
      );
      const sec = content.match(sectionRe);
      if (sec) {
        verdicts[label] = (sec[1]!.match(/^- \*\*/gm) ?? []).length;
      }
    }
  }

  return {
    filename,
    date,
    videoId,
    title,
    videoUrl,
    routedTo,
    confidence,
    verdicts,
  };
}

export async function listReportsMeta(): Promise<ReportMeta[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(PLANS_DIR);
    const playlistFiles = files
      .filter((f) => f.startsWith("playlist-") && f.endsWith(".md"))
      .sort()
      .reverse();

    const results: ReportMeta[] = [];
    for (const file of playlistFiles) {
      const content = await Bun.file(`${PLANS_DIR}/${file}`)
        .text()
        .catch(() => "");
      results.push(parseReportMeta(file, content));
    }
    return results;
  } catch {
    return [];
  }
}

export async function getReportContent(
  filename: string,
): Promise<string | null> {
  if (!/^playlist-\d{4}-\d{2}-\d{2}-[a-zA-Z0-9_-]+\.md$/.test(filename))
    return null;
  try {
    return await Bun.file(`${PLANS_DIR}/${filename}`).text();
  } catch {
    return null;
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

  const handlePlaylistError = (err: unknown): void => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("playlist:check-error", { error: errorMsg });
    import("../jobs/self-heal.ts")
      .then(({ triggerSelfHeal }) =>
        triggerSelfHeal(
          {
            source: "playlist",
            name: "check",
            error: errorMsg,
            timestamp: Date.now(),
          },
          bot,
        ),
      )
      .catch(() => {});
  };

  setTimeout(() => {
    checkPlaylists().catch(handlePlaylistError);
    setInterval(() => {
      checkPlaylists().catch(handlePlaylistError);
    }, 3_600_000);
  }, msUntilNextHour);
}
