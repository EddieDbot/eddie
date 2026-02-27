import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { PieceMetadata, ReviewReport, ScanResult } from "./types.ts";
import { scan } from "./scan.ts";
import { checkDependencies } from "./deps.ts";

async function hashFile(path: string): Promise<string> {
  try {
    const content = await Bun.file(path).text();
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return "";
  }
}

async function checkDuplicates(
  metadata: PieceMetadata,
  scanResults: ScanResult[],
): Promise<{ similar: string[]; uniquenessScore: number }> {
  // Hash-based duplicate detection against known pieces registry
  // For now, compare against locally installed pieces
  const hashes: string[] = [];
  for (const result of scanResults) {
    const hash = await hashFile(result.file);
    if (hash) hashes.push(hash);
  }

  // Check against a local registry if it exists
  const registryPath = resolve(
    import.meta.dir,
    "../../data/heimdall-registry.json",
  );
  let knownPieces: Record<string, { hashes: string[]; id: string }> = {};
  try {
    const content = await Bun.file(registryPath).text();
    knownPieces = JSON.parse(content);
  } catch {
    // No registry yet — everything is unique
  }

  const similar: string[] = [];
  let matchCount = 0;

  for (const [id, piece] of Object.entries(knownPieces)) {
    if (id === metadata.id) continue;
    const overlap = hashes.filter((h) => piece.hashes.includes(h));
    if (overlap.length > 0) {
      similar.push(id);
      matchCount += overlap.length;
    }
  }

  const totalFiles = hashes.length || 1;
  const uniquenessScore = Math.max(
    0,
    Math.round((1 - matchCount / totalFiles) * 100),
  );

  return { similar, uniquenessScore };
}

function validateMetadata(metadata: PieceMetadata): string[] {
  const issues: string[] = [];

  if (!metadata.id) issues.push("Missing required field: id");
  if (!metadata.name) issues.push("Missing required field: name");
  if (!metadata.type) issues.push("Missing required field: type");
  if (!metadata.version) issues.push("Missing required field: version");
  if (!metadata.author) issues.push("Missing required field: author");
  if (!metadata.description) issues.push("Missing required field: description");
  if (!metadata.tags || metadata.tags.length === 0)
    issues.push("No tags specified — add at least one for discoverability");

  // Validate semver-ish format
  if (metadata.version && !/^\d+\.\d+\.\d+/.test(metadata.version)) {
    issues.push(`Version "${metadata.version}" doesn't follow semver format`);
  }

  // Validate id is kebab-case
  if (metadata.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(metadata.id)) {
    issues.push(`ID "${metadata.id}" should be kebab-case`);
  }

  return issues;
}

export async function review(
  target: string,
): Promise<ReviewReport> {
  const resolved = resolve(target);

  // Load metadata
  const metadataPath = resolve(resolved, "metadata.json");
  let metadata: PieceMetadata;
  const issues: string[] = [];
  const recommendations: string[] = [];

  try {
    const content = await Bun.file(metadataPath).text();
    metadata = JSON.parse(content) as PieceMetadata;
  } catch {
    return {
      pieceId: "unknown",
      passed: false,
      scanResults: [],
      duplicateCheck: { similar: [], uniquenessScore: 0 },
      dependencyCheck: { missing: [], resolvable: false },
      issues: ["No metadata.json found. Create one before review."],
      recommendations: [
        "Create a metadata.json with required fields: id, name, type, version, author, description, tags",
      ],
    };
  }

  // Validate metadata
  const metadataIssues = validateMetadata(metadata);
  issues.push(...metadataIssues);

  // Run scan
  const scanResults = await scan(resolved);
  const dirty = scanResults.filter((r) => !r.clean);
  if (dirty.length > 0) {
    const refCount = dirty.reduce(
      (sum, r) => sum + r.personalRefs.length,
      0,
    );
    issues.push(
      `${refCount} personal reference(s) found in ${dirty.length} file(s) — run 'heimdall clean' first`,
    );
  }

  // Check duplicates
  const duplicateCheck = await checkDuplicates(metadata, scanResults);
  if (duplicateCheck.similar.length > 0) {
    recommendations.push(
      `Similar pieces found: ${duplicateCheck.similar.join(", ")}. Ensure this piece adds unique value.`,
    );
  }

  // Check dependencies
  const depResult = await checkDependencies(metadata);
  const missing = [
    ...depResult.envVars.filter((e) => !e.present).map((e) => `env:${e.name}`),
    ...depResult.mcps.filter((m) => !m.present).map((m) => `mcp:${m.name}`),
    ...depResult.scripts.filter((s) => !s.present).map((s) => `script:${s.name}`),
  ];

  if (missing.length > 0) {
    recommendations.push(
      `Missing dependencies: ${missing.join(", ")}. Document setup instructions.`,
    );
  }

  const passed = issues.length === 0 && dirty.length === 0;

  return {
    pieceId: metadata.id ?? "unknown",
    passed,
    scanResults,
    duplicateCheck,
    dependencyCheck: { missing, resolvable: missing.length === 0 },
    issues,
    recommendations,
  };
}

function formatReport(report: ReviewReport): string {
  const status = report.passed ? "PASSED" : "FAILED";
  const lines = [
    `Review Report: ${report.pieceId}`,
    `Status: ${status}`,
    "",
  ];

  if (report.issues.length > 0) {
    lines.push("Issues:");
    for (const issue of report.issues) lines.push(`  - ${issue}`);
    lines.push("");
  }

  lines.push(`Uniqueness Score: ${report.duplicateCheck.uniquenessScore}%`);
  if (report.duplicateCheck.similar.length > 0) {
    lines.push(
      `Similar pieces: ${report.duplicateCheck.similar.join(", ")}`,
    );
  }
  lines.push("");

  if (report.dependencyCheck.missing.length > 0) {
    lines.push("Missing Dependencies:");
    for (const dep of report.dependencyCheck.missing)
      lines.push(`  - ${dep}`);
    lines.push("");
  }

  if (report.recommendations.length > 0) {
    lines.push("Recommendations:");
    for (const rec of report.recommendations) lines.push(`  - ${rec}`);
  }

  return lines.join("\n");
}

// CLI entry point
if (import.meta.main) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: bun run src/heimdall/review.ts <directory>");
    process.exit(1);
  }

  const report = await review(target);
  console.log(formatReport(report));
  process.exit(report.passed ? 0 : 1);
}
