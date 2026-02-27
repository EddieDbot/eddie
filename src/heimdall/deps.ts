import { resolve } from "node:path";
import { homedir, platform } from "node:os";
import type { PieceMetadata, DependencyResult, DepStatus } from "./types.ts";

const HOME = homedir();
const IS_MAC = platform() === "darwin";

// ── Checkers ────────────────────────────────────────────────────────────────

async function checkOnPath(cmd: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

async function checkNpm(pkgs: string[]): Promise<DepStatus[]> {
  const results: DepStatus[] = [];
  for (const pkg of pkgs) {
    // Check bun global installs and node_modules
    const proc = Bun.spawn(["bun", "pm", "ls", "--global"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    results.push({ name: pkg, present: out.includes(pkg), installedBy: "bun" });
  }
  return results;
}

async function checkGhExtensions(exts: string[]): Promise<DepStatus[]> {
  const results: DepStatus[] = [];
  let installed: string[] = [];
  try {
    const proc = Bun.spawn(["gh", "extension", "list"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    installed = out.split("\n").map((l) => l.split("\t")[1]?.trim() ?? "");
  } catch {
    // gh not available
  }
  for (const ext of exts) {
    results.push({
      name: ext,
      present: installed.some((i) => i.includes(ext.split("/")[1] ?? ext)),
      installedBy: "gh",
    });
  }
  return results;
}

async function checkSystem(pkgs: string[]): Promise<DepStatus[]> {
  const results: DepStatus[] = [];
  for (const pkg of pkgs) {
    // Check if it's available on PATH first (most reliable)
    const onPath = await checkOnPath(pkg);
    if (onPath) {
      results.push({ name: pkg, present: true });
      continue;
    }
    // Check package manager
    let present = false;
    if (IS_MAC) {
      const proc = Bun.spawn(["brew", "list", pkg], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      present = proc.exitCode === 0;
    } else {
      const proc = Bun.spawn(["dpkg", "-l", pkg], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      present = out.includes("ii  " + pkg);
    }
    results.push({ name: pkg, present });
  }
  return results;
}

async function checkMcps(mcps: string[]): Promise<DepStatus[]> {
  const mcpPath = resolve(HOME, ".mcp.json");
  let servers: Record<string, unknown> = {};
  try {
    const content = await Bun.file(mcpPath).text();
    servers = (JSON.parse(content) as { mcpServers?: Record<string, unknown> }).mcpServers ?? {};
  } catch {
    // no mcp config
  }
  return mcps.map((name) => ({ name, present: name in servers }));
}

async function checkEnvVars(vars: string[]): Promise<DepStatus[]> {
  const envPath = resolve(import.meta.dir, "../../.env");
  let envContent = "";
  try {
    envContent = await Bun.file(envPath).text();
  } catch {
    // no .env
  }
  return vars.map((name) => ({
    name,
    present: process.env[name] !== undefined || envContent.includes(`${name}=`),
  }));
}

// ── Installers ───────────────────────────────────────────────────────────────

async function installNpm(pkg: string): Promise<boolean> {
  console.log(`  → bun add ${pkg}`);
  const proc = Bun.spawn(["bun", "add", pkg], {
    stdout: "inherit",
    stderr: "inherit",
    cwd: resolve(import.meta.dir, "../.."),
  });
  await proc.exited;
  return proc.exitCode === 0;
}

async function installGhExtension(ext: string): Promise<boolean> {
  console.log(`  → gh extension install ${ext}`);
  const proc = Bun.spawn(["gh", "extension", "install", ext], {
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
  return proc.exitCode === 0;
}

async function installSystem(pkg: string): Promise<boolean> {
  if (IS_MAC) {
    console.log(`  → brew install ${pkg}`);
    const proc = Bun.spawn(["brew", "install", pkg], {
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } else {
    console.log(`  → apt install -y ${pkg}`);
    const proc = Bun.spawn(["sudo", "apt", "install", "-y", pkg], {
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
    return proc.exitCode === 0;
  }
}

// ── Main check + install ─────────────────────────────────────────────────────

function mergeDeps(metadata: PieceMetadata) {
  const d = metadata.dependencies ?? {};
  const r = metadata.requires ?? {};
  return {
    npm: d.npm ?? [],
    ghExtensions: d.ghExtensions ?? [],
    system: d.system ?? [],
    mcps: [...(d.mcps ?? []), ...(r.mcps ?? [])],
    env: [...(d.env ?? []), ...(r.envVars ?? [])],
  };
}

export async function checkDependencies(metadata: PieceMetadata): Promise<DependencyResult> {
  const deps = mergeDeps(metadata);
  const [npm, ghExtensions, system, mcps, envVars] = await Promise.all([
    checkNpm(deps.npm),
    checkGhExtensions(deps.ghExtensions),
    checkSystem(deps.system),
    checkMcps(deps.mcps),
    checkEnvVars(deps.env),
  ]);

  const allResolved =
    [...npm, ...ghExtensions, ...system, ...mcps, ...envVars].every((d) => d.present);

  return { npm, ghExtensions, system, mcps, envVars, scripts: [], allResolved };
}

export async function installMissing(
  result: DependencyResult,
  metadata: PieceMetadata,
): Promise<void> {
  const deps = mergeDeps(metadata);

  for (const pkg of result.npm.filter((d) => !d.present)) {
    await installNpm(pkg.name);
  }

  for (const ext of result.ghExtensions.filter((d) => !d.present)) {
    await installGhExtension(ext.name);
  }

  for (const pkg of result.system.filter((d) => !d.present)) {
    await installSystem(pkg.name);
  }

  const missingMcps = result.mcps.filter((d) => !d.present);
  if (missingMcps.length > 0) {
    console.log("\nMissing MCP servers (manual setup required):");
    for (const m of missingMcps) console.log(`  - ${m.name}`);
  }

  const missingEnv = result.envVars.filter((d) => !d.present);
  if (missingEnv.length > 0) {
    console.log("\nMissing env vars (add to .env):");
    for (const e of missingEnv) console.log(`  ${e.name}=`);
  }
}

function formatResult(result: DependencyResult): string {
  const lines: string[] = ["Dependency Check:\n"];
  const sections: Array<[string, typeof result.npm]> = [
    ["npm/bun packages", result.npm],
    ["gh extensions", result.ghExtensions],
    ["system tools", result.system],
    ["MCP servers", result.mcps],
    ["env vars", result.envVars],
  ];

  for (const [label, items] of sections) {
    if (items.length === 0) continue;
    lines.push(`  ${label}:`);
    for (const item of items) {
      lines.push(`    ${item.present ? "✓" : "✗"} ${item.name}`);
    }
  }

  lines.push("");
  lines.push(
    result.allResolved
      ? "All dependencies resolved."
      : "Missing dependencies — run with --install to resolve.",
  );
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const installFlag = args.includes("--install");
  const target = args.find((a) => !a.startsWith("--"));

  if (!target) {
    console.error("Usage: bun run src/heimdall/deps.ts <path-to-metadata.json> [--install]");
    process.exit(1);
  }

  let metadata: PieceMetadata;
  try {
    metadata = JSON.parse(await Bun.file(resolve(target)).text()) as PieceMetadata;
  } catch (e) {
    console.error(`Failed to read metadata: ${e}`);
    process.exit(1);
  }

  const result = await checkDependencies(metadata);
  console.log(formatResult(result));

  if (installFlag && !result.allResolved) {
    console.log("\nInstalling missing dependencies...");
    await installMissing(result, metadata);
    // Re-check after install
    const recheck = await checkDependencies(metadata);
    console.log("\nAfter install:");
    console.log(formatResult(recheck));
    process.exit(recheck.allResolved ? 0 : 1);
  }

  process.exit(result.allResolved ? 0 : 1);
}
