const USAGE = `
Heimdall — EDDIE Piece Distribution Bridge

Usage: bun run src/heimdall/index.ts <command> [args]

Commands:
  scan <file|dir>        Scan for personal references
  clean <file|dir>       Parameterize personal refs (dry-run by default, --write to apply)
  package <dir>          Bundle a piece for distribution (--force to skip scan)
  review <dir>           Quality/safety review of a piece
  sync                   Check community repo for updates
  deps <metadata.json>   Check dependency resolution
  track                  Show local piece usage stats
  status                 Show local vs upstream diff
  ignore <file>          Mark file as personal-only (never sync)

Examples:
  bun run src/heimdall/index.ts scan ./src/
  bun run src/heimdall/index.ts clean ./my-agent/ --write
  bun run src/heimdall/index.ts package ./pieces/my-agent/
  bun run src/heimdall/index.ts review ./pieces/my-agent/
  bun run src/heimdall/index.ts sync
  bun run src/heimdall/index.ts deps ./pieces/my-agent/metadata.json
  bun run src/heimdall/index.ts track
  bun run src/heimdall/index.ts ignore ./src/personal-stuff.ts
`.trim();

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  switch (command) {
    case "scan": {
      const { scan } = await import("./scan.ts");
      const target = rest[0];
      if (!target) {
        console.error("Usage: heimdall scan <file|directory>");
        process.exit(1);
      }
      const results = await scan(target);
      const dirty = results.filter((r) => !r.clean);
      if (dirty.length === 0) {
        console.log("All files clean. No personal references found.");
      } else {
        for (const r of dirty) {
          console.log(`\n${r.file}:`);
          for (const ref of r.personalRefs) {
            console.log(
              `  L${ref.line} [${ref.confidence}] (${ref.type}) ${ref.match}`,
            );
            console.log(`    -> ${ref.suggestion}`);
          }
        }
        const total = dirty.reduce((sum, r) => sum + r.personalRefs.length, 0);
        console.log(
          `\nTotal: ${total} reference(s) in ${dirty.length} file(s)`,
        );
      }
      process.exit(dirty.length > 0 ? 1 : 0);
      break;
    }

    case "clean": {
      const { buildChanges, applyChanges } = await import("./clean.ts");
      const { scan } = await import("./scan.ts");
      const target = rest.find((a) => !a.startsWith("--"));
      const writeMode = rest.includes("--write");

      if (!target) {
        console.error("Usage: heimdall clean <file|directory> [--write]");
        process.exit(1);
      }

      const results = await scan(target);
      const changes = buildChanges(results);

      if (changes.length === 0) {
        console.log("No changes needed. All files are clean.");
        process.exit(0);
      }

      if (writeMode) {
        const applied = await applyChanges(changes);
        console.log(`Applied ${applied} change(s).`);
      } else {
        console.log(`${changes.length} change(s) would be applied:\n`);
        let currentFile = "";
        for (const change of changes) {
          if (change.file !== currentFile) {
            currentFile = change.file;
            console.log(`  ${change.file}:`);
          }
          console.log(`    L${change.line}: ${change.original}`);
          console.log(`         -> ${change.replacement}`);
        }
        console.log("\nRun with --write to apply changes.");
      }
      break;
    }

    case "package": {
      const { packagePiece } = await import("./package.ts");
      const target = rest.find((a) => !a.startsWith("--"));
      const force = rest.includes("--force");

      if (!target) {
        console.error("Usage: heimdall package <directory> [--force]");
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
      break;
    }

    case "review": {
      const { review } = await import("./review.ts");
      const target = rest[0];
      if (!target) {
        console.error("Usage: heimdall review <directory>");
        process.exit(1);
      }

      const report = await review(target);
      const status = report.passed ? "PASSED" : "FAILED";
      console.log(`Review: ${report.pieceId} — ${status}\n`);

      if (report.issues.length > 0) {
        console.log("Issues:");
        for (const issue of report.issues) console.log(`  - ${issue}`);
        console.log("");
      }

      console.log(`Uniqueness: ${report.duplicateCheck.uniquenessScore}%`);

      if (report.dependencyCheck.missing.length > 0) {
        console.log("\nMissing dependencies:");
        for (const dep of report.dependencyCheck.missing)
          console.log(`  - ${dep}`);
      }

      if (report.recommendations.length > 0) {
        console.log("\nRecommendations:");
        for (const rec of report.recommendations) console.log(`  - ${rec}`);
      }

      process.exit(report.passed ? 0 : 1);
      break;
    }

    case "sync": {
      const { checkForUpdates } = await import("./sync.ts");
      console.log("Checking community repository for updates...\n");
      const entries = await checkForUpdates();

      const newPieces = entries.filter((e) => e.status === "new");
      const updates = entries.filter((e) => e.status === "update");
      const upToDate = entries.filter((e) => e.status === "up-to-date");

      if (newPieces.length > 0) {
        console.log("New pieces available:");
        for (const p of newPieces)
          console.log(`  + ${p.name} (${p.id}) v${p.availableVersion}`);
        console.log("");
      }

      if (updates.length > 0) {
        console.log("Updates available:");
        for (const p of updates)
          console.log(
            `  ~ ${p.name} (${p.id}) ${p.currentVersion} -> ${p.availableVersion}`,
          );
        console.log("");
      }

      if (entries.length === 0) {
        console.log("No pieces found in the community repository.");
      } else {
        console.log(`${upToDate.length} piece(s) up to date.`);
      }
      break;
    }

    case "deps": {
      const { checkDependencies } = await import("./deps.ts");
      const target = rest[0];
      if (!target) {
        console.error("Usage: heimdall deps <path-to-metadata.json>");
        process.exit(1);
      }

      let metadata;
      try {
        const content = await Bun.file(target).text();
        metadata = JSON.parse(content);
      } catch (e) {
        console.error(`Failed to read metadata: ${e}`);
        process.exit(1);
      }

      const result = await checkDependencies(metadata);

      if (result.envVars.length > 0) {
        console.log("Environment Variables:");
        for (const v of result.envVars)
          console.log(`  ${v.present ? "[ok]" : "[MISSING]"} ${v.name}`);
      }

      if (result.mcps.length > 0) {
        console.log("MCP Servers:");
        for (const m of result.mcps)
          console.log(`  ${m.present ? "[ok]" : "[MISSING]"} ${m.name}`);
      }

      if (result.scripts.length > 0) {
        console.log("Scripts/Tools:");
        for (const s of result.scripts)
          console.log(`  ${s.present ? "[ok]" : "[MISSING]"} ${s.name}`);
      }

      console.log(
        result.allResolved
          ? "\nAll dependencies resolved."
          : "\nSome dependencies are missing.",
      );
      process.exit(result.allResolved ? 0 : 1);
      break;
    }

    case "track": {
      const { getStats } = await import("./track.ts");
      const stats = await getStats();

      if (stats.pieces.length === 0) {
        console.log("No piece usage recorded yet.");
      } else {
        console.log("Local Piece Usage:\n");
        const sorted = [...stats.pieces].sort(
          (a, b) => b.useCount - a.useCount,
        );
        for (const piece of sorted) {
          const date = new Date(piece.lastUsed).toLocaleDateString();
          console.log(
            `  ${piece.name} (${piece.id}) — ${piece.useCount} uses, last: ${date}`,
          );
        }
        console.log(`\nTotal: ${stats.pieces.length} piece(s) tracked.`);
        if (stats.lastReported) {
          console.log(
            `Last reported: ${new Date(stats.lastReported).toLocaleString()}`,
          );
        }
      }
      break;
    }

    case "ignore": {
      const target = rest[0];
      if (!target) {
        console.error("Usage: heimdall ignore <file>");
        process.exit(1);
      }

      const { resolve: resolvePath } = await import("node:path");
      const { mkdir: mkdirFs } = await import("node:fs/promises");
      const dataDir = resolvePath(import.meta.dir, "../../data");
      const ignorePath = resolvePath(dataDir, "heimdall-ignore.json");

      await mkdirFs(dataDir, { recursive: true });

      let ignored: string[] = [];
      try {
        const content = await Bun.file(ignorePath).text();
        ignored = JSON.parse(content) as string[];
      } catch {
        // No ignore list yet
      }

      const resolved = resolvePath(target);
      if (ignored.includes(resolved)) {
        console.log(`Already ignored: ${resolved}`);
      } else {
        ignored.push(resolved);
        await Bun.write(ignorePath, JSON.stringify(ignored, null, 2));
        console.log(`Ignored: ${resolved}`);
        console.log("This file will be skipped during sync operations.");
      }
      break;
    }

    case "status": {
      const { checkForUpdates } = await import("./sync.ts");
      console.log("Comparing local vs upstream...\n");
      const entries = await checkForUpdates();

      const actionable = entries.filter((e) => e.status !== "up-to-date");
      if (actionable.length === 0) {
        console.log("Everything is up to date.");
      } else {
        for (const entry of actionable) {
          const icon =
            entry.status === "new"
              ? "+"
              : entry.status === "update"
                ? "~"
                : "!";
          console.log(
            `  ${icon} ${entry.name} (${entry.id}) — ${entry.status}`,
          );
        }
        console.log(`\n${actionable.length} piece(s) need attention.`);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

main();
