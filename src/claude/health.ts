import { config } from "../config.ts";
import { existsSync, realpathSync } from "node:fs";

export type HealthStatus = {
  ok: boolean;
  version?: string;
  error?: string;
};

// Detect dangling symlink: symlink exists but target does not (race during auto-update).
// Returns error string if dangling, null if healthy.
function checkDanglingSymlink(binaryPath: string): string | null {
  try {
    if (!existsSync(binaryPath)) return `binary not found: ${binaryPath}`;
    // realpathSync resolves symlinks — throws ENOENT if target missing
    realpathSync(binaryPath);
    return null;
  } catch (err) {
    return `dangling symlink: ${binaryPath} → target missing (${err instanceof Error ? err.message : String(err)})`;
  }
}

export async function checkClaude(): Promise<HealthStatus> {
  // Guard: catch dangling symlink before attempting spawn (avoids ENOENT posix_spawn crash)
  const symlinkErr = checkDanglingSymlink(config.CLAUDE_PATH);
  if (symlinkErr) return { ok: false, error: symlinkErr };

  try {
    const proc = Bun.spawn([config.CLAUDE_PATH, "-p", "ping", "--output-format", "json"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return { ok: false, error: stderr.trim() || `Exit code ${exitCode}` };
    }

    try {
      const result = JSON.parse(stdout);
      return { ok: true, version: result.model ?? undefined };
    } catch {
      return { ok: true };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
