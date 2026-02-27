/**
 * One-off: spawn ingestion jobs for playlist videos that were marked processed
 * but never had transcripts fetched/analyzed.
 *
 * Usage: bun run src/scripts/ingest-missed-videos.ts
 */

import { createJob } from "../jobs/manager.ts";
import { spawnJob } from "../jobs/tmux.ts";
import { BRAIN_VAULT_ROOT, PLANS_DIR, INBOX_DIR } from "../memory/brain-vault-paths.ts";

const RAW_BUCKET = `${INBOX_DIR}/transcripts/_raw`;
const UNUSED_DIR = `${INBOX_DIR}/transcripts/_unused`;
const PLAYLIST_MANAGER = `${process.env.HOME}/.claude/scripts/playlist-manager.py`;
const PLAYLIST_NAME = "EDDIE Inbox";
const PLAYLIST_URL = "https://youtube.com/playlist?list=PLgSl4exmSE0mb6bBQIF5ITyYe0spOvW2H";
const DIGESTED_PLAYLIST_URL = "https://youtube.com/playlist?list=PLgSl4exmSE0kXhDdqcYE5vmjaxamTh-bL";

const MISSED_VIDEOS = [
  { id: "bd43QVl9ZfM", title: "Can we solve the AI agent security problem?" },
  { id: "oFgHjHeuXVY", title: "AI Killed SaaS. Build This NOW To Cash In (Crazy Profits)" },
  { id: "G6sjXjGilLQ", title: "How I Make Money with OpenClaw (+Free Skill)" },
  { id: "l0h3nAW13ao", title: "From Idea to $650M Exit: Lessons in Building AI Startups" },
  { id: "nhFQXfFDaIM", title: "AI tools that will make you rich (TIER LIST)" },
  { id: "h_N2Y2XyR3M", title: "OpenClaw Google Setup is a Nightmare (Here's the Fix)" },
  { id: "hcc0RmMdXSQ", title: "Why everyone's talking about Manus right now (Better than openclaw)" },
  { id: "romGzY0Xu0s", title: "This Just Fixed 90% Of AI Coding" },
];

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function buildJobPrompt(videoId: string, title: string): string {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const date = new Date().toISOString().split("T")[0];
  const slug = slugify(title);
  const rawPath = `${RAW_BUCKET}/${date}-${videoId}-${slug}.md`;
  const reportPath = `${PLANS_DIR}/playlist-${date}-${videoId}.md`;

  return `## Playlist Ingestion: ${title}

**Video:** ${videoUrl}
**Playlist:** ${PLAYLIST_NAME}
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
**Playlist:** ${PLAYLIST_NAME}

---

[full transcript text here]
\`\`\`

## Step 2: Move to Digested Playlist

Once the raw transcript is saved to the bucket, immediately move the video from the source playlist to the EDDIE Digested playlist.

Run:
\`\`\`bash
python3 ${PLAYLIST_MANAGER} move "${PLAYLIST_URL}" "${DIGESTED_PLAYLIST_URL}" "${videoId}"
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
**Source:** ${PLAYLIST_NAME}
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

If \`bun run\` fails, log and continue — vector push is best-effort.

## Step 7: Final Output

End your response with this exact line:
PLAYLIST_REPORT: ${title} | net_new=N | improve=N | in_backlog=N | have_it=N | skip=N | routed=[project or archived] | ${reportPath}
`;
}

async function main() {
  console.log(`Spawning ingestion jobs for ${MISSED_VIDEOS.length} missed videos...\n`);

  const CONCURRENCY = 3;
  for (let i = 0; i < MISSED_VIDEOS.length; i += CONCURRENCY) {
    const batch = MISSED_VIDEOS.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ id, title }) => {
        const prompt = buildJobPrompt(id, title);
        const job = await createJob("claude", prompt, { tmuxPrefix: "playlist" });
        await spawnJob(job);
        console.log(`✅ Spawned: ${title} (${id}) → job ${job.id}`);
      })
    );
    if (i + CONCURRENCY < MISSED_VIDEOS.length) {
      console.log("Waiting 2s before next batch...");
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\nDone. ${MISSED_VIDEOS.length} jobs spawned. Watch /jobs in Telegram or check tmux.`);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
