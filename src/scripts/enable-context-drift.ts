#!/usr/bin/env bun
/**
 * enable-context-drift.ts — auto-enables CONTEXT_DRIFT_ENABLED once >= 10 job hashes are stored
 * Intended to run every 30 minutes via system cron.
 * Usage: bun run ~/eddie/src/scripts/enable-context-drift.ts
 */
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";

const ENV_FILE = resolve(import.meta.dir, "../../.env");
const MIN_HASHES = 10;

async function countJobHashes(): Promise<number> {
  if (!memoryEnabled) return 0;
  const { data, error } = await getSupabase()
    .from("jobs")
    .select("system_prompt_hash")
    .not("system_prompt_hash", "is", null)
    .in("status", ["completed", "failed"]);
  if (error || !data) return 0;
  const unique = new Set(data.map((r) => r.system_prompt_hash as string));
  return unique.size;
}

async function isAlreadyEnabled(): Promise<boolean> {
  try {
    const content = await readFile(ENV_FILE, "utf-8");
    return /^CONTEXT_DRIFT_ENABLED\s*=\s*true/m.test(content);
  } catch {
    return false;
  }
}

async function enableFlag(): Promise<void> {
  try {
    const content = await readFile(ENV_FILE, "utf-8");
    if (/^CONTEXT_DRIFT_ENABLED\s*=/m.test(content)) {
      const updated = content.replace(
        /^CONTEXT_DRIFT_ENABLED\s*=.*/m,
        "CONTEXT_DRIFT_ENABLED=true",
      );
      await writeFile(ENV_FILE, updated, "utf-8");
    } else {
      await writeFile(ENV_FILE, content + "\nCONTEXT_DRIFT_ENABLED=true\n", "utf-8");
    }
    logger.info("enable-context-drift:enabled");
    console.log("✓ CONTEXT_DRIFT_ENABLED=true written to .env");
  } catch (err) {
    logger.error("enable-context-drift:write-failed", { error: String(err) });
    console.error("Failed to write .env:", err);
    process.exit(1);
  }
}

const alreadyEnabled = await isAlreadyEnabled();
if (alreadyEnabled) {
  console.log("Already enabled — nothing to do.");
  process.exit(0);
}

const count = await countJobHashes();
console.log(`Job hashes in DB: ${count} (threshold: ${MIN_HASHES})`);

if (count >= MIN_HASHES) {
  await enableFlag();
} else {
  console.log(`Not yet — need ${MIN_HASHES - count} more hashes.`);
}

process.exit(0);
