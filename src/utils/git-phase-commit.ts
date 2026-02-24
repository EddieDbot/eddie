import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";
import { homedir } from "node:os";

const PROJECT_ROOT = resolve(homedir(), "eddie");

export type PhaseCommitResult = {
  committed: boolean;
  sha?: string;
  message?: string;
};

export async function commitPhase(jobId: string, stepName: string): Promise<PhaseCommitResult> {
  // Stage all modified files
  const addProc = Bun.spawn(["git", "add", "-A"], {
    cwd: PROJECT_ROOT,
    stdout: "ignore",
    stderr: "ignore",
  });
  await addProc.exited;

  // Check if there's anything to commit
  const statusProc = Bun.spawn(["git", "status", "--porcelain"], {
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "ignore",
  });
  const statusOut = await new Response(statusProc.stdout).text();
  if (!statusOut.trim()) {
    return { committed: false, message: "nothing to commit" };
  }

  const message = `auto: job-${jobId} phase ${stepName} [EDDIE]`;
  const commitProc = Bun.spawn(["git", "commit", "-m", message], {
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "ignore",
  });
  const code = await commitProc.exited;

  if (code !== 0) {
    logger.warn("git-phase-commit:failed", { jobId, stepName });
    return { committed: false };
  }

  // Get the SHA
  const shaProc = Bun.spawn(["git", "rev-parse", "--short", "HEAD"], {
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "ignore",
  });
  const sha = (await new Response(shaProc.stdout).text()).trim();

  logger.info("git-phase-commit:committed", { jobId, stepName, sha });
  return { committed: true, sha, message };
}
