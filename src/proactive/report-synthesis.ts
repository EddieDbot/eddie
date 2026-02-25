import { homedir } from "node:os";
import { createJob } from "../jobs/manager.ts";
import { spawnJob } from "../jobs/tmux.ts";
import { logger } from "../utils/logger.ts";

import { PLANS_DIR } from "../memory/brain-vault-paths.ts";
const ROADMAP_PATH = `${PLANS_DIR}/execution-roadmap.md`;

let scheduledSynthesis: ReturnType<typeof setTimeout> | null = null;

async function buildSynthesisPrompt(): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(PLANS_DIR).catch(() => [] as string[]);
  const reports = files
    .filter((f) => f.startsWith("playlist-") && f.endsWith(".md"))
    .sort()
    .reverse();

  const fileList = reports.map((f) => `- ${PLANS_DIR}/${f}`).join("\n");

  return `## Report Synthesis: EDDIE Execution Roadmap

You are synthesizing ${reports.length} playlist ingestion reports into a single prioritized execution roadmap.

**Report files to read:**
${fileList}

---

## Your Task

1. **Read every report listed above.** For each, extract:
   - All NET_NEW items (genuinely new ideas to implement)
   - All IMPROVE items (enhancements to existing features)
   - The project it was routed to
   - Skip HAVE_IT, IN_BACKLOG, SKIP items — note their count only

2. **Deduplicate.** Multiple videos often cover the same technique. Merge near-identical items into one entry, noting all source video IDs.

3. **Score each surviving item:**
   - **Effort:** S (<1 hr) / M (1–4 hrs) / L (1 day) / XL (multi-day)
   - **Impact:** 1–5 (how much does this improve EDDIE's value or Nicholas's workflow)

4. **Group by domain:**
   - EDDIE-core (direct improvements to this codebase: jobs, comms, dashboard, agents)
   - claude-mastery (workflow patterns, CLAUDE.md design, agent architecture)
   - command-center (dashboard, tooling, ops)
   - ai-money (monetization, business automation)
   - creative-technologist (design tools, creative workflow)

5. **Write the roadmap to:** ${ROADMAP_PATH}

Use this exact format:

\`\`\`markdown
# EDDIE Execution Roadmap

**Generated:** <date>
**Reports synthesized:** <N>
**Items:** <N NET_NEW> NET_NEW + <N IMPROVE> IMPROVE = <total> actionable (after dedup)

---

## 🔥 Top 10 — Execute Now

Highest impact, lowest effort. These should be done first.

| # | Item | Domain | Effort | Impact | Source |
|---|------|--------|--------|--------|--------|
| 1 | ... | ... | S | 5 | videoId |

For each item below the table, add one bullet with implementation specifics:
- **#1 — Item name** — Which files to touch, what pattern to apply, key detail from the video.

---

## By Domain

### EDDIE-core
<!-- NET_NEW and IMPROVE items for the EDDIE codebase -->
- **[Effort/Impact]** Item — detail

### claude-mastery
...

### command-center
...

### ai-money
...

### creative-technologist
...

---

## Deferred
<!-- Lower impact or XL effort — worth doing eventually -->

---

## Completed
<!-- Move items here as they ship, with date -->
\`\`\`

6. After writing the file, end your response with:
SYNTHESIS_COMPLETE: <N> actionable items | <N> domains | roadmap written to ${ROADMAP_PATH}
`;
}

export async function runReportSynthesis(): Promise<{
  jobId: string;
  session: string;
}> {
  const prompt = await buildSynthesisPrompt();
  const job = await createJob("claude", prompt, { timeoutMs: 25 * 60_000 });
  await spawnJob(job);
  logger.info("report-synthesis:spawned", {
    jobId: job.id,
    session: job.tmuxSession,
  });
  return { jobId: String(job.id), session: job.tmuxSession };
}

export type RoadmapItem = {
  id: string;
  name: string;
  description: string;
  domain: string;
  effort: "S" | "M" | "L" | "XL";
  impact: number;
  type: "NET_NEW" | "IMPROVE";
  status: "pending" | "deferred" | "completed";
  sources: string[];
};

function parseItemLine(
  line: string,
  domain: string,
  type: "NET_NEW" | "IMPROVE",
  status: "pending" | "deferred" | "completed",
): RoadmapItem | null {
  if (!line.startsWith("- **[")) return null;
  const inner = line.slice(5);
  const bracketEnd = inner.indexOf("]**");
  if (bracketEnd === -1) return null;
  const effortImpact = inner.slice(0, bracketEnd);
  const slashIdx = effortImpact.indexOf("/");
  if (slashIdx === -1) return null;
  const effort = effortImpact.slice(0, slashIdx).trim() as
    | "S"
    | "M"
    | "L"
    | "XL";
  const impact = parseInt(effortImpact.slice(slashIdx + 1).trim()) || 3;
  let rest = inner.slice(bracketEnd + 3).trim();
  const sourcesMatch = rest.match(/\s+\*\(([^)]+)\)\*$/);
  const sources = sourcesMatch
    ? sourcesMatch[1]!.split(",").map((s) => s.trim())
    : [];
  if (sourcesMatch)
    rest = rest.slice(0, rest.length - sourcesMatch[0].length).trim();
  const dashIdx = rest.indexOf(" — ");
  const rawName = dashIdx >= 0 ? rest.slice(0, dashIdx) : rest;
  const description = dashIdx >= 0 ? rest.slice(dashIdx + 3).trim() : "";
  const name = rawName.replace(/\*\*/g, "").trim();
  if (!name) return null;
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return {
    id,
    name,
    description,
    domain,
    effort,
    impact,
    type,
    status,
    sources,
  };
}

export async function parseRoadmapItems(): Promise<RoadmapItem[]> {
  const content = await Bun.file(ROADMAP_PATH)
    .text()
    .catch(() => "");
  if (!content) return [];
  const items: RoadmapItem[] = [];
  const lines = content.split("\n");
  let currentDomain = "general";
  let currentType: "NET_NEW" | "IMPROVE" = "NET_NEW";
  let currentStatus: "pending" | "deferred" | "completed" = "pending";
  let inDomainSection = false;
  for (const line of lines) {
    const t = line.trim();
    if (t === "## By Domain") {
      inDomainSection = true;
      continue;
    }
    if (t.startsWith("## Deferred")) {
      inDomainSection = false;
      currentStatus = "deferred";
      currentDomain = "deferred";
      currentType = "NET_NEW";
      continue;
    }
    if (t.startsWith("## Completed")) {
      inDomainSection = false;
      currentStatus = "completed";
      currentDomain = "completed";
      currentType = "NET_NEW";
      continue;
    }
    if (t.startsWith("## ")) {
      inDomainSection = false;
      continue;
    }
    if (inDomainSection && t.startsWith("### ")) {
      currentDomain = t.slice(4).trim();
      currentType = "NET_NEW";
      currentStatus = "pending";
      continue;
    }
    if (t.startsWith("**NET_NEW:**")) {
      currentType = "NET_NEW";
      continue;
    }
    if (t.startsWith("**IMPROVE:**")) {
      currentType = "IMPROVE";
      continue;
    }
    const item = parseItemLine(t, currentDomain, currentType, currentStatus);
    if (item) items.push(item);
  }
  return items;
}

// Schedule synthesis ~90 min after playlist jobs are spawned.
// Debounced — only one pending synthesis at a time.
export function scheduleSynthesis(delayMs = 90 * 60_000): void {
  if (scheduledSynthesis) {
    clearTimeout(scheduledSynthesis);
  }
  scheduledSynthesis = setTimeout(() => {
    scheduledSynthesis = null;
    runReportSynthesis().catch((err) => {
      logger.error("report-synthesis:auto-error", { error: String(err) });
    });
  }, delayMs);
  logger.info("report-synthesis:scheduled", {
    inMinutes: Math.round(delayMs / 60_000),
  });
}
