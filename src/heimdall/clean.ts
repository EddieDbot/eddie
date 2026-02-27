import { resolve } from "node:path";
import type { ScanResult, CleanChange } from "./types.ts";
import { scan } from "./scan.ts";

export function buildChanges(results: ScanResult[]): CleanChange[] {
  const changes: CleanChange[] = [];

  for (const result of results) {
    if (result.clean) continue;
    for (const ref of result.personalRefs) {
      changes.push({
        file: result.file,
        line: ref.line,
        original: ref.match,
        replacement: ref.suggestion,
        type: ref.type,
      });
    }
  }

  return changes;
}

export async function applyChanges(changes: CleanChange[]): Promise<number> {
  // Group changes by file
  const byFile = new Map<string, CleanChange[]>();
  for (const change of changes) {
    const existing = byFile.get(change.file) ?? [];
    existing.push(change);
    byFile.set(change.file, existing);
  }

  let applied = 0;
  for (const [filePath, fileChanges] of byFile) {
    const file = Bun.file(filePath);
    let content = await file.text();

    for (const change of fileChanges) {
      const before = content;
      content = content.replaceAll(change.original, change.replacement);
      if (content !== before) applied++;
    }

    await Bun.write(filePath, content);
  }

  return applied;
}

function formatDryRun(changes: CleanChange[]): string {
  if (changes.length === 0) return "No changes needed. All files are clean.";

  const lines: string[] = [`${changes.length} change(s) would be applied:\n`];

  let currentFile = "";
  for (const change of changes) {
    if (change.file !== currentFile) {
      currentFile = change.file;
      lines.push(`  ${change.file}:`);
    }
    lines.push(`    L${change.line}: ${change.original}`);
    lines.push(`         -> ${change.replacement}`);
  }

  lines.push("\nRun with --write to apply changes.");
  return lines.join("\n");
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2);
  const writeMode = args.includes("--write");
  const target = args.find((a) => !a.startsWith("--"));

  if (!target) {
    console.error("Usage: bun run src/heimdall/clean.ts <file|directory> [--write]");
    console.error("  --write  Apply changes (default: dry-run)");
    process.exit(1);
  }

  const resolved = resolve(target);
  const results = await scan(resolved);
  const changes = buildChanges(results);

  if (writeMode) {
    const applied = await applyChanges(changes);
    console.log(`Applied ${applied} change(s).`);
  } else {
    console.log(formatDryRun(changes));
  }
}
