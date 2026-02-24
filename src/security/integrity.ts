import { resolve } from "node:path";
import { homedir } from "node:os";
import { logger } from "../utils/logger.ts";

const HOME = homedir();

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
  logger.info("integrity:baseline-set", { files: baseline.size });
}

export async function checkIntegrity(): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];

  for (const file of WATCHED_FILES) {
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

  return issues;
}
