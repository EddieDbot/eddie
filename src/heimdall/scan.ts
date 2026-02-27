import { resolve, relative } from "node:path";
import { homedir } from "node:os";
import { readdir, stat } from "node:fs/promises";
import type { ScanResult, PersonalRef, RefType } from "./types.ts";

const HOME = homedir();
const USERNAME = HOME.split("/").pop() ?? "";

interface Pattern {
  regex: RegExp;
  type: RefType;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  suggest: (match: string) => string;
}

const PATTERNS: Pattern[] = [
  // Absolute paths with username
  {
    regex: new RegExp(`/home/${USERNAME}/|/Users/${USERNAME}/`, "g"),
    type: "path",
    confidence: "HIGH",
    suggest: () => "${EDDIE_HOME}/",
  },
  // Generic home paths with any username
  {
    regex: /\/home\/[a-z_][a-z0-9_-]*\/|\/Users\/[A-Za-z][A-Za-z0-9_-]*\//g,
    type: "path",
    confidence: "MEDIUM",
    suggest: () => "${EDDIE_HOME}/",
  },
  // Email addresses
  {
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    type: "email",
    confidence: "HIGH",
    suggest: () => "${EDDIE_OWNER_EMAIL}",
  },
  // API keys / tokens (common prefixes)
  {
    regex:
      /(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36,}|ghu_[a-zA-Z0-9]{36,}|xoxb-[a-zA-Z0-9-]+|xoxp-[a-zA-Z0-9-]+)/g,
    type: "credential",
    confidence: "HIGH",
    suggest: (match: string) => {
      if (match.startsWith("sk-")) return "${ANTHROPIC_API_KEY}";
      if (match.startsWith("ghp_") || match.startsWith("ghu_"))
        return "${GITHUB_TOKEN}";
      if (match.startsWith("xox")) return "${SLACK_TOKEN}";
      return "${API_KEY}";
    },
  },
  // High-entropy strings that look like secrets (32+ hex or base64 chars)
  {
    regex: /(?:['"`])([A-Za-z0-9+/=_-]{40,})(?:['"`])/g,
    type: "credential",
    confidence: "LOW",
    suggest: () => "${SECRET_VALUE}",
  },
  // IPv4 addresses (not localhost)
  {
    regex:
      /\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    type: "ip",
    confidence: "MEDIUM",
    suggest: () => "${HOST_IP}",
  },
  // Tailscale URLs
  {
    regex: /[a-z0-9-]+\.tail[a-f0-9]+\.ts\.net/g,
    type: "ip",
    confidence: "HIGH",
    suggest: () => "${TAILSCALE_HOST}",
  },
  // Phone numbers (US format)
  {
    regex: /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    type: "id",
    confidence: "MEDIUM",
    suggest: () => "${OWNER_PHONE}",
  },
];

// Files/directories to always skip
const SKIP_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /dist\//,
  /\.env$/,
  /\.env\.local$/,
  /bun\.lockb$/,
  /\.tar\.gz$/,
  /\.png$|\.jpg$|\.jpeg$|\.gif$|\.ico$/,
];

function shouldSkip(filePath: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(filePath));
}

async function collectFiles(target: string): Promise<string[]> {
  const s = await stat(target);
  if (s.isFile()) return [target];

  const files: string[] = [];
  const entries = await readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(target, entry.name);
    if (shouldSkip(full)) continue;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

export async function scanFile(filePath: string): Promise<ScanResult> {
  const file = Bun.file(filePath);
  const refs: PersonalRef[] = [];

  try {
    const content = await file.text();
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const pattern of PATTERNS) {
        // Reset regex lastIndex for global patterns
        pattern.regex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pattern.regex.exec(line)) !== null) {
          refs.push({
            line: i + 1,
            match: m[0],
            type: pattern.type,
            confidence: pattern.confidence,
            suggestion: pattern.suggest(m[0]),
          });
        }
      }
    }
  } catch {
    // Binary file or unreadable — skip
  }

  return {
    file: filePath,
    personalRefs: refs,
    clean: refs.length === 0,
  };
}

export async function scan(target: string): Promise<ScanResult[]> {
  const resolved = resolve(target);
  const files = await collectFiles(resolved);
  const results: ScanResult[] = [];

  for (const f of files) {
    if (shouldSkip(f)) continue;
    const result = await scanFile(f);
    results.push(result);
  }

  return results;
}

function formatResults(results: ScanResult[], basePath: string): string {
  const dirty = results.filter((r) => !r.clean);
  if (dirty.length === 0)
    return "All files clean. No personal references found.";

  const lines: string[] = [
    `Found personal references in ${dirty.length} file(s):\n`,
  ];

  for (const result of dirty) {
    const rel = relative(basePath, result.file);
    lines.push(`  ${rel}:`);
    for (const ref of result.personalRefs) {
      lines.push(
        `    L${ref.line} [${ref.confidence}] (${ref.type}) ${ref.match}`,
      );
      lines.push(`      -> ${ref.suggestion}`);
    }
    lines.push("");
  }

  const total = dirty.reduce((sum, r) => sum + r.personalRefs.length, 0);
  lines.push(`Total: ${total} reference(s) in ${dirty.length} file(s)`);
  return lines.join("\n");
}

// CLI entry point
if (import.meta.main) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: bun run src/heimdall/scan.ts <file|directory>");
    process.exit(1);
  }

  const resolved = resolve(target);
  const results = await scan(resolved);
  console.log(formatResults(results, resolved));

  const dirty = results.filter((r) => !r.clean);
  process.exit(dirty.length > 0 ? 1 : 0);
}
