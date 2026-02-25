#!/usr/bin/env bun
/**
 * roadmap-dedup.ts — Scan codebase before roadmap execution to prevent rebuilding
 * existing features. Greps for key identifiers per roadmap item.
 * Usage: bun run ~/eddie/src/scripts/roadmap-dedup.ts [--roadmap <path>]
 */

import { resolve } from "node:path";
import { homedir } from "node:os";
import { readdir } from "node:fs/promises";

const HOME = homedir();
const EDDIE_SRC = resolve(HOME, "eddie/src");
const CAPABILITIES_PATH = resolve(HOME, "eddie/src/routing/capabilities.ts");
const CONFIG_PATH = resolve(HOME, "eddie/src/config.ts");
const INDEX_PATH = resolve(HOME, "eddie/src/index.ts");

type DedupeStatus = "BUILT" | "PARTIAL" | "NOT_BUILT";

type RoadmapCheck = {
  item: string;
  identifiers: string[];
  status: DedupeStatus;
  found: string[];
};

async function grepSrc(pattern: string): Promise<string[]> {
  const proc = Bun.spawnSync(
    ["grep", "-rl", "--include=*.ts", pattern, EDDIE_SRC],
    { stdout: "pipe", stderr: "pipe" }
  );
  const out = proc.stdout.toString().trim();
  return out ? out.split("\n").filter(Boolean) : [];
}

async function checkItem(item: string, identifiers: string[]): Promise<RoadmapCheck> {
  const found: string[] = [];

  for (const id of identifiers) {
    const hits = await grepSrc(id);
    if (hits.length > 0) {
      found.push(`${id} → ${hits.map(h => h.replace(EDDIE_SRC + "/", "src/")).join(", ")}`);
    }
  }

  let status: DedupeStatus;
  if (found.length === 0) {
    status = "NOT_BUILT";
  } else if (found.length >= identifiers.length * 0.7) {
    status = "BUILT";
  } else {
    status = "PARTIAL";
  }

  return { item, identifiers, status, found };
}

const CHECKS: Array<{ item: string; identifiers: string[] }> = [
  // Security
  { item: "Self-heal error context", identifiers: ["buildHealPrompt", "outputTail", "stepErrors"] },
  { item: "Self-heal path-based approval", identifiers: ["healRiskLevel", "heal-risk"] },
  { item: "Job performance tracking", identifiers: ["appendPerfLog", "self_heal_log", "job-performance"] },
  { item: "Security council", identifiers: ["startSecurityCouncil", "security-council", "SECURITY_COUNCIL_ENABLED"] },
  { item: "MCP audit (basic)", identifiers: ["runMcpAudit", "mcp-audit", "MCP_AUDIT_LOG_ENABLED"] },
  { item: "Hooks validation", identifiers: ["validateHooks", "hooks-validator", "HOOKS_VALIDATION_ENABLED"] },
  { item: "Trust classification", identifiers: ["classifySource", "TrustLevel", "TRUST_CLASSIFICATION_ENABLED"] },
  { item: "Integrity check", identifiers: ["checkIntegrity", "initBaseline", "INTEGRITY_CHECK_ENABLED"] },

  // Intelligence
  { item: "Morning brief enrichment", identifiers: ["buildBriefText", "startMorningBrief"] },
  { item: "Outcome analysis", identifiers: ["runOutcomeAnalysis", "gatherWeeklyData"] },
  { item: "Voice-to-text", identifiers: ["handleVoice", "transcribeAudio"] },
  { item: "Content brief pipeline", identifiers: ["generateContentBrief", "content-brief"] },

  // Job system
  { item: "Job multimodal (attachments)", identifiers: ["attachments", "job_attachments", "--image"] },
  { item: "Per-phase verification", identifiers: ["verifyPhaseArtifacts", "STEP_COMPLETE"] },
  { item: "Deferred MCP loading", identifiers: ["JOB_MCP_MAP", "LOAD_THESE_MCPS"] },

  // UX
  { item: "Slack slash commands", identifiers: ["/status", "/jobs", "handleSlashCommand"] },
  { item: "Bookmark upgrade (URL fetch)", identifiers: ["bookmark", "storeFact", "generateSummary"] },
  { item: "Weekly content batch", identifiers: ["weeklyContent", "weekly-content", "WEEKLY_CONTENT_ENABLED"] },
  { item: "Brainstorm batch mode", identifiers: ["brainstorm", "--batch"] },
  { item: "Living brief", identifiers: ["refreshBriefDelta", "livingBrief"] },
  { item: "Transcript watcher", identifiers: ["transcript-watcher", "TRANSCRIPT_WATCHER_ENABLED"] },

  // Feedback
  { item: "Job feedback buttons", identifiers: ["job_feedback", "InlineKeyboard", "jf:good"] },
  { item: "Rejection learning", identifiers: ["rejection-learning", "runRejectionLearning"] },

  // Infrastructure
  { item: "Team namespaces", identifiers: ["namespace", "makeSessionName.*namespace"] },
  { item: "Kanban blocked field", identifiers: ["blocked", "blockedReason", "getP1Tasks"] },
  { item: "YouTube Supabase dedup", identifiers: ["processed-video", "loadProcessed"] },
  { item: "Weekly 80/20 review", identifiers: ["weekly-8020", "runWeekly8020"] },
  { item: "Confidence-gated routing", identifiers: ["confidence", "RoutingResult.*confidence"] },
  { item: "Context budget dashboard", identifiers: ["context-budget", "heaviestJobs"] },
  { item: "Sandbox execution", identifiers: ["sandboxed", "strace", "job_sandbox"] },
  { item: "Programmatic tool calling", identifiers: ["invoke.ts", "src/tools/invoke"] },
  { item: "API reference generator", identifiers: ["gen-api-reference", "generateApiReference"] },
];

async function main() {
  console.log("# Roadmap Dedup Check\n");
  console.log(`Scanning: ${EDDIE_SRC}\n`);

  const results: RoadmapCheck[] = [];

  for (const check of CHECKS) {
    const result = await checkItem(check.item, check.identifiers);
    results.push(result);
  }

  const built = results.filter(r => r.status === "BUILT");
  const partial = results.filter(r => r.status === "PARTIAL");
  const notBuilt = results.filter(r => r.status === "NOT_BUILT");

  console.log(`## ✅ BUILT (${built.length})`);
  for (const r of built) {
    console.log(`- **${r.item}**`);
    for (const f of r.found.slice(0, 2)) console.log(`  - ${f}`);
  }

  console.log(`\n## ⚠️ PARTIAL (${partial.length})`);
  for (const r of partial) {
    console.log(`- **${r.item}** — found ${r.found.length}/${r.identifiers.length} identifiers`);
    for (const f of r.found) console.log(`  - ${f}`);
  }

  console.log(`\n## 🔴 NOT BUILT (${notBuilt.length})`);
  for (const r of notBuilt) {
    console.log(`- **${r.item}**`);
  }

  console.log(`\n---\nTotal: ${results.length} | Built: ${built.length} | Partial: ${partial.length} | Not Built: ${notBuilt.length}`);
}

main().catch(console.error);
