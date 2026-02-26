#!/usr/bin/env bun
/**
 * cleanup.ts — EDDIE system housekeeping
 * Kills zombie tmux sessions, archives old job files, purges stale state files, cleans /tmp.
 * Usage: bun run ~/eddie/src/scripts/cleanup.ts
 */
import { readdir, rm, mkdir, rename, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { logger } from "../utils/logger.ts";

const HOME = homedir();
const JOBS_DIR = resolve(HOME, "eddie/data/jobs");
const ARCHIVE_DIR = resolve(JOBS_DIR, "archive");
const STATE_DIR = resolve(HOME, "brain-vault/90 - Agent Memory/State");

const KEEP_SESSIONS = new Set([
  "eddie",
  "video-test",
  "video-pipeline-test",
  "eddie-remote-control",
]);

const NOW_MS = Date.now();
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TWO_HOURS_MS = 2 * HOUR_MS;
const THIRTY_MIN_MS = 30 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const THREE_DAYS_MS = 3 * DAY_MS;
const FOURTEEN_DAYS_MS = 14 * DAY_MS;

// ── tmux zombie killer ─────────────────────────────────────────────────────

async function killZombieSessions(): Promise<number> {
  const proc = Bun.spawn(
    ["tmux", "list-sessions", "-F", "#{session_name} #{session_created}"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const output = await new Response(proc.stdout).text();
  await proc.exited;

  if (!output.trim()) return 0;

  const nowSec = Math.floor(NOW_MS / 1000);
  let killed = 0;

  for (const line of output.trim().split("\n")) {
    const parts = line.trim().split(" ");
    if (parts.length < 2) continue;
    const name = parts[0] as string;
    const createdStr = parts[1] as string;
    const createdSec = parseInt(createdStr, 10);
    if (isNaN(createdSec)) continue;

    const ageMs = (nowSec - createdSec) * 1000;

    if (KEEP_SESSIONS.has(name)) continue;
    if (ageMs < THIRTY_MIN_MS) continue;
    if (ageMs < TWO_HOURS_MS) continue;

    // Session is >2 hours old and not in keep list — kill it
    const kill = Bun.spawn(["tmux", "kill-session", "-t", name], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await kill.exited;
    logger.info("cleanup:tmux:killed", {
      session: name,
      ageHours: Math.floor(ageMs / HOUR_MS),
    });
    killed++;
  }

  return killed;
}

// ── job file archiver ──────────────────────────────────────────────────────

async function archiveOldJobFiles(): Promise<number> {
  if (!existsSync(JOBS_DIR)) return 0;

  await mkdir(ARCHIVE_DIR, { recursive: true });

  const files = await readdir(JOBS_DIR);
  let archived = 0;

  for (const file of files) {
    if (!file.startsWith("job-")) continue;
    if (
      !file.endsWith(".json") &&
      !file.endsWith("-system.txt") &&
      !file.endsWith("-output.txt") &&
      !file.endsWith("-runner.sh") &&
      !file.endsWith("-prompt.txt")
    )
      continue;

    const filePath = resolve(JOBS_DIR, file);
    const info = await stat(filePath).catch(() => null);
    if (!info) continue;

    const ageMs = NOW_MS - info.mtimeMs;
    if (ageMs < SEVEN_DAYS_MS) continue;

    const dest = resolve(ARCHIVE_DIR, file);
    await rename(filePath, dest).catch((err) =>
      logger.error("cleanup:archive:rename-failed", {
        file,
        error: String(err),
      }),
    );
    archived++;
  }

  return archived;
}

// ── stale state file purger ────────────────────────────────────────────────

async function purgeStaleStateFiles(): Promise<number> {
  if (!existsSync(STATE_DIR)) return 0;

  const files = await readdir(STATE_DIR);
  let purged = 0;

  for (const file of files) {
    const filePath = resolve(STATE_DIR, file);
    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) continue;

    const ageMs = NOW_MS - info.mtimeMs;

    const isDailyBrief = /^daily-brief-\d{4}-\d{2}-\d{2}\.md$/.test(file);
    const isHandoff = /.*-handoff-.*\.md$/.test(file);

    if (isDailyBrief && ageMs > THREE_DAYS_MS) {
      await rm(filePath).catch((err) =>
        logger.error("cleanup:state:rm-failed", { file, error: String(err) }),
      );
      logger.info("cleanup:state:purged", { file, reason: "daily-brief >3d" });
      purged++;
    } else if (isHandoff && ageMs > FOURTEEN_DAYS_MS) {
      await rm(filePath).catch((err) =>
        logger.error("cleanup:state:rm-failed", { file, error: String(err) }),
      );
      logger.info("cleanup:state:purged", { file, reason: "handoff >14d" });
      purged++;
    }
  }

  return purged;
}

// ── /tmp cleaner ───────────────────────────────────────────────────────────

async function cleanTmp(): Promise<number> {
  const { readdir: readdirAsync } = await import("node:fs/promises");
  let cleaned = 0;

  const tmpFiles = await readdirAsync("/tmp").catch(() => [] as string[]);
  for (const file of tmpFiles) {
    if (!file.startsWith("eddie-") && !file.startsWith("job-")) continue;

    const filePath = `/tmp/${file}`;
    const info = await stat(filePath).catch(() => null);
    if (!info) continue;

    const ageMs = NOW_MS - info.mtimeMs;
    if (ageMs < DAY_MS) continue;

    await rm(filePath, { recursive: true, force: true }).catch((err) =>
      logger.error("cleanup:tmp:rm-failed", { file, error: String(err) }),
    );
    cleaned++;
  }

  return cleaned;
}

// ── main ───────────────────────────────────────────────────────────────────

export async function runCleanup(): Promise<void> {
  const start = Date.now();
  logger.info("cleanup:start");

  const [zombies, archived, purged, tmpCleaned] = await Promise.all([
    killZombieSessions(),
    archiveOldJobFiles(),
    purgeStaleStateFiles(),
    cleanTmp(),
  ]);

  const durationMs = Date.now() - start;

  console.log(`[cleanup] done in ${durationMs}ms`);
  console.log(`  tmux zombies killed: ${zombies}`);
  console.log(`  job files archived:  ${archived}`);
  console.log(`  state files purged:  ${purged}`);
  console.log(`  /tmp files cleaned:  ${tmpCleaned}`);

  logger.info("cleanup:done", {
    zombies,
    archived,
    purged,
    tmpCleaned,
    durationMs,
  });
}

if (import.meta.main) {
  runCleanup().catch((err) => {
    console.error("[cleanup] fatal:", err);
    process.exit(1);
  });
}
