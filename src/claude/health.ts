import { config } from "../config.ts";

export type HealthStatus = {
  ok: boolean;
  version?: string;
  error?: string;
};

export async function checkClaude(): Promise<HealthStatus> {
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
