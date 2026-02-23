import { exists } from "node:fs/promises";
import { resolve } from "node:path";

const HOME = process.env.HOME ?? "/home/na";
const BRAIN_VAULT = `${HOME}/brain-vault`;

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

export function getExpectedArtifacts(jobType: string, prompt: string): ArtifactSpec[] {
  if (jobType === "research") {
    // Playlist jobs should produce a report file
    if (prompt.toLowerCase().includes("playlist") || prompt.toLowerCase().includes("video")) {
      const today = new Date().toISOString().slice(0, 10);
      return [
        {
          description: "Playlist report in Plans/",
          check: async () => {
            // Check if any playlist report was created today
            const plansDir = resolve(BRAIN_VAULT, "90 - Agent Memory/Plans");
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
    if (prompt.toLowerCase().includes("synthesis") || prompt.toLowerCase().includes("roadmap")) {
      return [
        {
          description: "execution-roadmap.md updated",
          check: async () => {
            const roadmap = resolve(BRAIN_VAULT, "90 - Agent Memory/Plans/execution-roadmap.md");
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
            { cwd: "/home/na/eddie", stdout: "ignore", stderr: "ignore" }
          );
          const code = await proc.exited;
          return code === 0;
        },
      },
    ];
  }

  return []; // No specific artifacts for general/code jobs
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
