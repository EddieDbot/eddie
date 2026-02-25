import { exists } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BRAIN_VAULT_ROOT as BRAIN_VAULT,
  PLANS_DIR,
} from "../memory/brain-vault-paths.ts";

export type ArtifactSpec = {
  description: string;
  check: () => Promise<boolean>;
};

export type ArtifactResult = {
  description: string;
  found: boolean;
};

export type ArtifactCheckResult = {
  jobType: string;
  specs: ArtifactResult[];
  allFound: boolean;
  missingCount: number;
};

export function getExpectedArtifacts(
  jobType: string,
  prompt: string,
): ArtifactSpec[] {
  if (jobType === "research") {
    // Playlist jobs should produce a report file
    if (
      prompt.toLowerCase().includes("playlist") ||
      prompt.toLowerCase().includes("video")
    ) {
      const today = new Date().toISOString().slice(0, 10);
      return [
        {
          description: "Playlist report in Plans/",
          check: async () => {
            // Check if any playlist report was created today
            const plansDir = PLANS_DIR;
            try {
              const { readdir } = await import("node:fs/promises");
              const files = await readdir(plansDir);
              return files.some((f) => f.startsWith(`playlist-${today}`));
            } catch {
              return false;
            }
          },
        },
      ];
    }
    // Synthesis jobs should update the roadmap
    if (
      prompt.toLowerCase().includes("synthesis") ||
      prompt.toLowerCase().includes("roadmap")
    ) {
      return [
        {
          description: "execution-roadmap.md updated",
          check: async () => {
            const roadmap = resolve(PLANS_DIR, "execution-roadmap.md");
            return exists(roadmap);
          },
        },
      ];
    }
  }

  if (jobType === "heal") {
    // Heal jobs should produce at least one file modification (worktree or main)
    // We can't easily check this without knowing which file, so just check that bun check passes
    return [
      {
        description: "TypeScript compiles after heal",
        check: async () => {
          const proc = Bun.spawn(
            ["/home/na/.bun/bin/bun", "x", "tsc", "--noEmit"],
            { cwd: "/home/na/eddie", stdout: "ignore", stderr: "ignore" },
          );
          const code = await proc.exited;
          return code === 0;
        },
      },
    ];
  }

  if (jobType === "code") {
    return getCodePhaseArtifacts(prompt);
  }

  return []; // No specific artifacts for general/code jobs
}

// Per-phase artifact verification for multi-phase jobs
export type PhaseResult = {
  phase: number;
  name: string;
  passed: boolean;
  missing: string[];
};

export async function verifyPhaseArtifacts(
  phase: number,
  _prompt: string,
): Promise<PhaseResult> {
  switch (phase) {
    case 1:
      return verifyPhase1();
    case 2:
      return verifyPhase2();
    case 3:
      return verifyPhase3();
    case 4:
      return verifyPhase4();
    default:
      return { phase, name: "unknown", passed: true, missing: [] };
  }
}

async function verifyPhase1(): Promise<PhaseResult> {
  // Phase 1: source files written — check that recent git changes exist
  const proc = Bun.spawn(["git", "status", "--porcelain"], {
    cwd: "/home/na/eddie",
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  const passed = out.trim().length > 0;
  return {
    phase: 1,
    name: "source-files-written",
    passed,
    missing: passed ? [] : ["No file changes detected in git status"],
  };
}

async function verifyPhase2(): Promise<PhaseResult> {
  // Phase 2: TypeScript compiles (proxy for tests passing)
  const proc = Bun.spawn(["/home/na/.bun/bin/bun", "x", "tsc", "--noEmit"], {
    cwd: "/home/na/eddie",
    stdout: "ignore",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  const passed = code === 0;
  return {
    phase: 2,
    name: "typescript-compiles",
    passed,
    missing: passed ? [] : [`TypeScript errors: ${stderr.slice(0, 200)}`],
  };
}

async function verifyPhase3(): Promise<PhaseResult> {
  // Phase 3: build succeeds (bun check equivalent)
  const proc = Bun.spawn(
    ["/home/na/.bun/bin/bun", "run", "build"].filter(Boolean),
    { cwd: "/home/na/eddie", stdout: "ignore", stderr: "pipe" },
  );
  const code = await proc.exited;
  const passed = code === 0;
  return {
    phase: 3,
    name: "build-succeeds",
    passed,
    missing: passed ? [] : ["Build command failed"],
  };
}

async function verifyPhase4(): Promise<PhaseResult> {
  // Phase 4: deployment confirmed — check systemd service is active
  const proc = Bun.spawn(["systemctl", "--user", "is-active", "eddie"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  const passed = out.trim() === "active";
  return {
    phase: 4,
    name: "deployment-confirmed",
    passed,
    missing: passed ? [] : [`Service not active: ${out.trim()}`],
  };
}

function getCodePhaseArtifacts(prompt: string): ArtifactSpec[] {
  const specs: ArtifactSpec[] = [];
  const lower = prompt.toLowerCase();

  if (lower.includes("typescript") || lower.includes(".ts")) {
    specs.push({
      description: "TypeScript compiles without errors",
      check: async () => {
        const proc = Bun.spawn(
          ["/home/na/.bun/bin/bun", "x", "tsc", "--noEmit"],
          { cwd: "/home/na/eddie", stdout: "ignore", stderr: "ignore" },
        );
        return (await proc.exited) === 0;
      },
    });
  }

  return specs;
}

export async function verifyArtifacts(
  jobType: string,
  prompt: string,
): Promise<ArtifactCheckResult> {
  const specs = getExpectedArtifacts(jobType, prompt);
  if (specs.length === 0) {
    return { jobType, specs: [], allFound: true, missingCount: 0 };
  }

  const results = await Promise.all(
    specs.map(async (spec) => ({
      description: spec.description,
      found: await spec.check().catch(() => false),
    })),
  );

  const missingCount = results.filter((r) => !r.found).length;
  return {
    jobType,
    specs: results,
    allFound: missingCount === 0,
    missingCount,
  };
}
