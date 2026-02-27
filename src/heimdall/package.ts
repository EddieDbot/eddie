import { resolve, basename, relative, dirname } from "node:path";
import { readdir, stat, mkdir } from "node:fs/promises";
import type { PieceMetadata } from "./types.ts";
import { scan } from "./scan.ts";

async function collectPackageFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isDirectory()) {
      files.push(...(await collectPackageFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

function generateReadme(metadata: PieceMetadata): string {
  const lines = [
    `# ${metadata.name}`,
    "",
    metadata.description,
    "",
    `**Type:** ${metadata.type}`,
    `**Version:** ${metadata.version}`,
    `**Author:** ${metadata.author}`,
    "",
  ];

  if (metadata.tags.length > 0) {
    lines.push(`**Tags:** ${metadata.tags.join(", ")}`, "");
  }

  const dep = metadata.dependencies ?? {};
  const req = metadata.requires ?? {};
  const hasReqs =
    dep.npm?.length ||
    dep.ghExtensions?.length ||
    dep.system?.length ||
    dep.mcps?.length ||
    dep.env?.length ||
    req.envVars?.length ||
    req.mcps?.length ||
    req.scripts?.length;

  if (hasReqs) {
    lines.push("## Requirements", "");
    if (dep.npm?.length) {
      lines.push("### npm/bun Packages", "");
      for (const v of dep.npm) lines.push(`- \`${v}\``);
      lines.push("");
    }
    if (dep.ghExtensions?.length) {
      lines.push("### GitHub Extensions", "");
      for (const v of dep.ghExtensions) lines.push(`- \`${v}\``);
      lines.push("");
    }
    if (dep.system?.length) {
      lines.push("### System Tools", "");
      for (const v of dep.system) lines.push(`- \`${v}\``);
      lines.push("");
    }
    if (dep.mcps?.length || req.mcps?.length) {
      lines.push("### MCP Servers", "");
      for (const m of [...(dep.mcps ?? []), ...(req.mcps ?? [])])
        lines.push(`- \`${m}\``);
      lines.push("");
    }
    if (dep.env?.length || req.envVars?.length) {
      lines.push("### Environment Variables", "");
      for (const v of [...(dep.env ?? []), ...(req.envVars ?? [])])
        lines.push(`- \`${v}\``);
      lines.push("");
    }
    if (dep.claudeTier ?? req.claudeTier) {
      lines.push(
        "### Claude Tier",
        "",
        `Requires: ${dep.claudeTier ?? req.claudeTier}`,
        "",
      );
    }
    if (req.scripts?.length) {
      lines.push("### Scripts/Tools", "");
      for (const s of req.scripts) lines.push(`- \`${s}\``);
      lines.push("");
    }
  }

  if (metadata.permissions) {
    const perms = metadata.permissions;
    const active = Object.entries(perms)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    if (active.length > 0) {
      lines.push("## Permissions", "");
      lines.push("This piece requires the following EDDIE capabilities:", "");
      const labels: Record<string, string> = {
        brainVaultRead: "Brain Vault (read)",
        brainVaultWrite: "Brain Vault (write)",
        bashExec: "Bash execution",
        network: "Outbound network",
        telegram: "Telegram messaging",
        spawnJobs: "Spawn background jobs",
      };
      for (const p of active) lines.push(`- ${labels[p] ?? p}`);
      lines.push("");
    }
  }

  lines.push("## Installation", "");
  lines.push("```bash");
  lines.push("bun run src/heimdall/index.ts review <package>");
  lines.push("# Then follow prompts to install");
  lines.push("```");

  return lines.join("\n");
}

export async function packagePiece(
  dir: string,
  opts: { force?: boolean; outDir?: string } = {},
): Promise<{ tarball: string; metadata: PieceMetadata } | { error: string }> {
  const resolved = resolve(dir);
  const outDir = resolve(opts.outDir ?? "./dist");

  // Check for metadata.json
  const metadataPath = resolve(resolved, "metadata.json");
  let metadata: PieceMetadata;

  try {
    const content = await Bun.file(metadataPath).text();
    metadata = JSON.parse(content) as PieceMetadata;
  } catch {
    return {
      error: `No metadata.json found in ${resolved}. Create one first.`,
    };
  }

  // Validate required metadata fields
  const missing: string[] = [];
  if (!metadata.id) missing.push("id");
  if (!metadata.name) missing.push("name");
  if (!metadata.type) missing.push("type");
  if (!metadata.version) missing.push("version");
  if (!metadata.author) missing.push("author");
  if (!metadata.description) missing.push("description");

  if (missing.length > 0) {
    return {
      error: `Incomplete metadata.json — missing: ${missing.join(", ")}`,
    };
  }

  // Run scan
  const results = await scan(resolved);
  const dirty = results.filter((r) => !r.clean);

  if (dirty.length > 0 && !opts.force) {
    const refCount = dirty.reduce((sum, r) => sum + r.personalRefs.length, 0);
    return {
      error: `Found ${refCount} personal reference(s) in ${dirty.length} file(s). Run 'heimdall clean' first, or use --force to override.`,
    };
  }

  // Ensure README exists
  const readmePath = resolve(resolved, "README.md");
  try {
    await Bun.file(readmePath).text();
  } catch {
    await Bun.write(readmePath, generateReadme(metadata));
  }

  // Create output directory
  await mkdir(outDir, { recursive: true });

  // Create tarball
  const tarballName = `${metadata.id}-${metadata.version}.tar.gz`;
  const tarballPath = resolve(outDir, tarballName);

  const proc = Bun.spawn(
    ["tar", "czf", tarballPath, "-C", dirname(resolved), basename(resolved)],
    { stdout: "pipe", stderr: "pipe" },
  );
  await proc.exited;

  if (proc.exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    return { error: `tar failed: ${stderr}` };
  }

  return { tarball: tarballPath, metadata };
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const target = args.find((a) => !a.startsWith("--"));

  if (!target) {
    console.error(
      "Usage: bun run src/heimdall/package.ts <directory> [--force]",
    );
    process.exit(1);
  }

  const result = await packagePiece(target, { force });

  if ("error" in result) {
    console.error(`Package failed: ${result.error}`);
    process.exit(1);
  }

  console.log(`Packaged: ${result.tarball}`);
  console.log(`  id: ${result.metadata.id}`);
  console.log(`  version: ${result.metadata.version}`);
  console.log(`  type: ${result.metadata.type}`);
}
