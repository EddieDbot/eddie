import { resolve } from "node:path";
import { homedir } from "node:os";
import { readdir, mkdir } from "node:fs/promises";
import { logger } from "../utils/logger.ts";

const HOME = homedir();

const AGENTS_DIR = resolve(HOME, ".claude/agents");
const BASELINE_PATH = resolve(HOME, "eddie/data/integrity-baseline.json");

const WATCHED_FILES = [
  resolve(HOME, "eddie/.env"),
  resolve(HOME, ".claude/google-hub/credentials.json"),
  resolve(HOME, ".claude/google-hub/service-account.json"),
  resolve(HOME, ".claude/settings/job-default.json"),
  resolve(HOME, ".claude/settings/code-job.json"),
  resolve(HOME, ".claude/settings/heal-job.json"),
  resolve(HOME, ".claude/settings/research-job.json"),
  resolve(HOME, ".claude/settings.json"),
];

export type IntegrityIssue = {
  file: string;
  status: "modified" | "deleted" | "new";
  detail: string;
};

const baseline = new Map<string, string>();

async function loadAgentFiles(): Promise<string[]> {
  try {
    const entries = await readdir(AGENTS_DIR);
    return entries
      .filter((f) => f.endsWith(".md"))
      .map((f) => resolve(AGENTS_DIR, f));
  } catch {
    return [];
  }
}

async function hashFile(path: string): Promise<string | null> {
  try {
    const content = await Bun.file(path).arrayBuffer();
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(content);
    return hasher.digest("hex");
  } catch {
    return null;
  }
}

async function saveBaseline(): Promise<void> {
  try {
    await mkdir(resolve(HOME, "eddie/data"), { recursive: true });
    await Bun.write(BASELINE_PATH, JSON.stringify(Object.fromEntries(baseline), null, 2));
  } catch (err) {
    logger.warn("integrity:baseline-save-error", { error: String(err) });
  }
}

async function loadPersistedBaseline(): Promise<boolean> {
  try {
    const content = await Bun.file(BASELINE_PATH).text();
    const obj = JSON.parse(content) as Record<string, string>;
    for (const [k, v] of Object.entries(obj)) {
      baseline.set(k, v);
    }
    logger.info("integrity:baseline-loaded", { files: baseline.size });
    return true;
  } catch {
    return false;
  }
}

async function computeBaseline(): Promise<void> {
  baseline.clear();
  for (const file of WATCHED_FILES) {
    const hash = await hashFile(file);
    if (hash) baseline.set(file, hash);
  }
  const agentFiles = await loadAgentFiles();
  for (const file of agentFiles) {
    const hash = await hashFile(file);
    if (hash) baseline.set(file, hash);
  }
}

export async function initBaseline(): Promise<void> {
  const loaded = await loadPersistedBaseline();
  if (loaded) return;

  // No persisted baseline — compute fresh and save
  await computeBaseline();
  await saveBaseline();
  logger.info("integrity:baseline-set", { files: baseline.size });
}

// Force recompute — call only after explicit user confirmation
export async function refreshBaseline(): Promise<void> {
  await computeBaseline();
  await saveBaseline();
  logger.info("integrity:baseline-refreshed", { files: baseline.size });
}

async function checkFiles(
  files: string[],
  issues: IntegrityIssue[],
): Promise<void> {
  for (const file of files) {
    const current = await hashFile(file);
    const original = baseline.get(file);

    if (!original && current) {
      // file appeared since baseline — not flagged
      continue;
    }

    if (original && !current) {
      issues.push({ file, status: "deleted", detail: `${file} was deleted` });
      continue;
    }

    if (original && current && original !== current) {
      issues.push({ file, status: "modified", detail: `${file} hash changed` });
    }
  }
}

export async function checkIntegrity(): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];

  await checkFiles(WATCHED_FILES, issues);

  const agentFiles = await loadAgentFiles();
  // Also check for new agent files added since baseline
  const newAgentFiles = agentFiles.filter((f) => !baseline.has(f));
  const trackedAgentFiles = agentFiles.filter((f) => baseline.has(f));

  await checkFiles(trackedAgentFiles, issues);

  for (const file of newAgentFiles) {
    issues.push({
      file,
      status: "new",
      detail: `${file} appeared after baseline`,
    });
  }

  return issues;
}
