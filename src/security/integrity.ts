import { resolve } from "node:path";
import { homedir } from "node:os";
import { readdir } from "node:fs/promises";
import { logger } from "../utils/logger.ts";

const HOME = homedir();

const AGENTS_DIR = resolve(HOME, ".claude/agents");

const WATCHED_FILES = [
  resolve(HOME, "eddie/.env"),
  resolve(HOME, ".claude/google-hub/credentials.json"),
  resolve(HOME, ".claude/google-hub/service-account.json"),
  resolve(HOME, ".claude/settings/job-default.json"),
  resolve(HOME, ".claude/settings/code-job.json"),
  resolve(HOME, ".claude/settings/heal-job.json"),
  resolve(HOME, ".claude/settings/research-job.json"),
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

export async function initBaseline(): Promise<void> {
  for (const file of WATCHED_FILES) {
    const hash = await hashFile(file);
    if (hash) baseline.set(file, hash);
  }
  const agentFiles = await loadAgentFiles();
  for (const file of agentFiles) {
    const hash = await hashFile(file);
    if (hash) baseline.set(file, hash);
  }
  logger.info("integrity:baseline-set", { files: baseline.size });
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
