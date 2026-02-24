#!/usr/bin/env bun
import { logProvenance } from "../memory/provenance.ts";

const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

const feature = getArg("--feature");
const sourceType = getArg("--source-type") ?? "manual";
const sourceRef = getArg("--source-ref");
const sourceTitle = getArg("--source-title");
const jobId = getArg("--job-id");
const agent = getArg("--agent");
const status = getArg("--status") ?? "shipped";
const notes = getArg("--notes");

if (!feature) {
  console.error("Usage: bun run src/scripts/log-provenance.ts --feature <name> [--source-type video|book|session|manual] [--source-ref <id>] [--source-title <title>] [--job-id <id>] [--agent <name>] [--status shipped|in-progress|planned] [--notes <text>]");
  process.exit(1);
}

// Force enable for CLI use
process.env.PROVENANCE_ENABLED = "true";
// Need Supabase
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  const envFile = Bun.file(`${process.env.HOME}/eddie/.env`);
  if (await envFile.exists()) {
    const raw = await envFile.text();
    for (const line of raw.split("\n")) {
      const [k, ...v] = line.split("=");
      if (k && v.length && !process.env[k]) process.env[k] = v.join("=");
    }
  }
}

await logProvenance({ feature_name: feature, source_type: sourceType, source_ref: sourceRef, source_title: sourceTitle, job_id: jobId, agent, status, notes });
console.log(`✓ Logged provenance: ${feature} (${sourceType}${sourceTitle ? `: ${sourceTitle}` : ""})`);
