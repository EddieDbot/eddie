import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { logger } from "../utils/logger.ts";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const WORKTREE_BASE = resolve(PROJECT_ROOT, ".worktrees");

export async function createWorktree(jobId: string): Promise<{ path: string; branch: string }> {
  const branch = `job/${jobId}`;
  const worktreePath = resolve(WORKTREE_BASE, jobId);

  const proc = Bun.spawn(
    ["git", "-C", PROJECT_ROOT, "worktree", "add", "-b", branch, worktreePath],
    { stdout: "pipe", stderr: "pipe" }
  );
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`git worktree add failed: ${err.trim()}`);
  }
  logger.info("worktree:created", { jobId, path: worktreePath, branch });
  return { path: worktreePath, branch };
}

export async function removeWorktree(jobId: string): Promise<boolean> {
  const worktreePath = resolve(WORKTREE_BASE, jobId);
  const branch = `job/${jobId}`;

  try {
    const proc = Bun.spawn(
      ["git", "-C", PROJECT_ROOT, "worktree", "remove", "--force", worktreePath],
      { stdout: "ignore", stderr: "ignore" }
    );
    await proc.exited;

    const branchProc = Bun.spawn(
      ["git", "-C", PROJECT_ROOT, "branch", "-D", branch],
      { stdout: "ignore", stderr: "ignore" }
    );
    await branchProc.exited;

    await rm(worktreePath, { recursive: true, force: true });
    logger.info("worktree:removed", { jobId });
    return true;
  } catch (err) {
    logger.warn("worktree:remove-failed", {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function cleanupOrphanedWorktrees(): Promise<number> {
  try {
    const proc = Bun.spawn(
      ["git", "-C", PROJECT_ROOT, "worktree", "prune"],
      { stdout: "ignore", stderr: "ignore" }
    );
    await proc.exited;

    const listProc = Bun.spawn(
      ["git", "-C", PROJECT_ROOT, "worktree", "list", "--porcelain"],
      { stdout: "pipe", stderr: "ignore" }
    );
    const output = await new Response(listProc.stdout).text();
    const jobWorktrees = output.split("\n").filter(l => l.includes(".worktrees/"));
    return jobWorktrees.length;
  } catch {
    return 0;
  }
}

export function shouldUseWorktree(prompt: string, tmuxPrefix?: string): boolean {
  if (tmuxPrefix?.startsWith("heal-")) return true;
  const lower = prompt.toLowerCase();
  return (
    lower.includes("src/") ||
    lower.includes("self-heal") ||
    lower.includes("implement ") ||
    lower.includes("fix the bug") ||
    lower.includes("refactor") ||
    lower.includes("modify ") ||
    lower.includes("update the code")
  );
}
