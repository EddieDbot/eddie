import { logger } from "../utils/logger.ts";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import os from "node:os";

const LOG_PATH = `${os.homedir()}/brain-vault/20 - Areas/EDDIE/youtube-strategy/pipeline-log.md`;

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function appendVideoEntry(entry: {
  renderId: string;
  headline: string;
  hook: string;
  emotionTarget: string;
  node: string;
  qaAttempts: number;
  qaIssues: string[];
  qaFinalPass: boolean;
  youtubeUrl: string;
  youtubeVideoId: string;
  postedAt: string;
}): Promise<void> {
  await ensureDir(LOG_PATH);

  const date = new Date(entry.postedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const qaStatus = entry.qaFinalPass ? "PASS" : "FAIL (posted anyway)";
  const issuesList =
    entry.qaIssues.length > 0
      ? entry.qaIssues.map((i) => `  - ${i}`).join("\n")
      : "  - none";

  const block = `
## ${date} — ${entry.headline}
**Render ID:** ${entry.renderId}
**Hook:** "${entry.hook}"
**Emotion target:** ${entry.emotionTarget}
**Node:** ${entry.node}
**QA attempts:** ${entry.qaAttempts} — ${qaStatus}
**QA issues fixed:**
${issuesList}
**YouTube:** ${entry.youtubeUrl}

`;

  await appendFile(LOG_PATH, block, "utf-8");
  logger.info("working-doc:video-entry-appended", { renderId: entry.renderId });
}

export async function appendAnalyticsEntry(entry: {
  youtubeVideoId: string;
  headline: string;
  views: number;
  likes: number;
  comments: number;
  avgViewDurationSec?: number;
  pulledAt: string;
  hoursAfterPublish: number;
}): Promise<void> {
  await ensureDir(LOG_PATH);

  const pct = entry.avgViewDurationSec
    ? ` / ${Math.round((entry.avgViewDurationSec / 30) * 100)}%`
    : "";

  const durationStr = entry.avgViewDurationSec
    ? `${entry.avgViewDurationSec}s${pct}`
    : "n/a";

  const block = `
### ${entry.hoursAfterPublish}h Analytics — ${entry.headline}
- Views: ${entry.views}
- Likes: ${entry.likes}
- Comments: ${entry.comments}
- Avg view duration: ${durationStr}

`;

  await appendFile(LOG_PATH, block, "utf-8");
  logger.info("working-doc:analytics-entry-appended", { videoId: entry.youtubeVideoId });
}
