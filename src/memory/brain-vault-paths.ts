import { resolve } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();

// ── Root constants ────────────────────────────────────────────────
export const BRAIN_VAULT_ROOT = resolve(HOME, "brain-vault");
export const STATE_DIR = resolve(BRAIN_VAULT_ROOT, "90 - Agent Memory/State");
export const LEARNINGS_DIR = resolve(BRAIN_VAULT_ROOT, "90 - Agent Memory/Learnings");
export const DECISIONS_DIR = resolve(BRAIN_VAULT_ROOT, "90 - Agent Memory/Decisions");
export const PLANS_DIR = resolve(BRAIN_VAULT_ROOT, "90 - Agent Memory/Plans");
export const INBOX_DIR = resolve(BRAIN_VAULT_ROOT, "00 - Inbox");
export const EDDIE_STATE_FILE = resolve(STATE_DIR, "eddie-current.md");

// ── Tier types ────────────────────────────────────────────────────
export type ProjectTier = "active" | "domain" | "identity" | "bucket";

export type SlugEntry = {
  tier: ProjectTier;
  /** Absolute path to the project/area/resource folder */
  path: string;
  /** Optional: state file slug if different from folder key */
  stateTier?: string;
};

// ── Slug registry ─────────────────────────────────────────────────
const SLUG_MAP: Record<string, SlugEntry> = {
  // Active Projects — stay in 10 - Projects/
  "crabill-leadgen": {
    tier: "active",
    path: resolve(BRAIN_VAULT_ROOT, "10 - Projects/crabill-leadgen"),
  },
  "fanways": {
    tier: "active",
    path: resolve(BRAIN_VAULT_ROOT, "10 - Projects/fanways"),
  },
  "motion-recreation": {
    tier: "active",
    path: resolve(BRAIN_VAULT_ROOT, "10 - Projects/motion-recreation"),
  },
  "shur": {
    tier: "active",
    path: resolve(BRAIN_VAULT_ROOT, "10 - Projects/shur"),
  },
  "freelance": {
    tier: "active",
    path: resolve(BRAIN_VAULT_ROOT, "10 - Projects/freelance"),
  },

  // Capability Domains — 20 - Areas/
  "eddie": {
    tier: "domain",
    path: resolve(BRAIN_VAULT_ROOT, "20 - Areas/EDDIE"),
  },
  "eddie-upgrades": {
    tier: "domain",
    path: resolve(BRAIN_VAULT_ROOT, "20 - Areas/EDDIE"),
  },
  "EDDIE-Upgrades": {
    tier: "domain",
    path: resolve(BRAIN_VAULT_ROOT, "20 - Areas/EDDIE"),
  },
  "agent-forge": {
    tier: "domain",
    path: resolve(BRAIN_VAULT_ROOT, "20 - Areas/AI Research/agent-forge"),
  },
  "claude-mastery": {
    tier: "domain",
    path: resolve(BRAIN_VAULT_ROOT, "20 - Areas/AI Research/claude-mastery"),
  },
  "home-lab-x": {
    tier: "domain",
    path: resolve(BRAIN_VAULT_ROOT, "20 - Areas/Homelab"),
  },
  "command-center": {
    tier: "domain",
    path: resolve(BRAIN_VAULT_ROOT, "20 - Areas/EDDIE/command-center"),
  },
  "treasure-map": {
    tier: "domain",
    path: resolve(BRAIN_VAULT_ROOT, "20 - Areas/EDDIE/treasure-map"),
  },

  // Identity Contexts — 20 - Areas/
  "creative-technologist": {
    tier: "identity",
    path: resolve(BRAIN_VAULT_ROOT, "20 - Areas/creative-technologist"),
  },

  // Idea Buckets — 30 - Resources/
  "ai-money": {
    tier: "bucket",
    path: resolve(BRAIN_VAULT_ROOT, "30 - Resources/ai-money"),
  },
  "session-nuggets": {
    tier: "bucket",
    path: resolve(BRAIN_VAULT_ROOT, "30 - Resources/session-nuggets"),
  },
  "vimeo-heygen-dub": {
    tier: "bucket",
    path: resolve(BRAIN_VAULT_ROOT, "30 - Resources/vimeo-heygen-dub"),
  },
  "health-optimization": {
    tier: "bucket",
    path: resolve(BRAIN_VAULT_ROOT, "30 - Resources/health-optimization"),
  },
  "puerto-rico-relocation": {
    tier: "bucket",
    path: resolve(BRAIN_VAULT_ROOT, "30 - Resources/puerto-rico-relocation"),
  },
  "peculiar-people": {
    tier: "bucket",
    path: resolve(BRAIN_VAULT_ROOT, "30 - Resources/peculiar-people"),
  },
};

// Case-insensitive lookup
function lookupSlug(slug: string): SlugEntry | undefined {
  return SLUG_MAP[slug] ?? SLUG_MAP[slug.toLowerCase()];
}

// ── Sync resolvers (zero I/O, hot path) ──────────────────────────

/** Returns the full folder path for a registered slug, or null if unknown. */
export function resolveSlugPath(slug: string): string | null {
  return lookupSlug(slug)?.path ?? null;
}

export function getSlugEntry(slug: string): SlugEntry | undefined {
  return lookupSlug(slug);
}

export function getSlugTier(slug: string): ProjectTier | null {
  return lookupSlug(slug)?.tier ?? null;
}

export function getEddieLogPath(slug: string): string {
  const base = resolveSlugPath(slug) ?? resolve(BRAIN_VAULT_ROOT, "10 - Projects", slug);
  return resolve(base, "EDDIE_LOG.md");
}

export function getTranscriptDir(slug: string): string {
  const base = resolveSlugPath(slug) ?? resolve(BRAIN_VAULT_ROOT, "10 - Projects", slug);
  return resolve(base, "notes/transcripts");
}

export function getProjectClaude(slug: string): string {
  const base = resolveSlugPath(slug) ?? resolve(BRAIN_VAULT_ROOT, "10 - Projects", slug);
  return resolve(base, "CLAUDE.md");
}

export function listSlugs(tier?: ProjectTier): string[] {
  const entries = Object.entries(SLUG_MAP);
  const filtered = tier ? entries.filter(([, v]) => v.tier === tier) : entries;
  // Deduplicate by path (e.g. eddie-upgrades aliases)
  const seen = new Set<string>();
  return filtered
    .filter(([, v]) => {
      if (seen.has(v.path)) return false;
      seen.add(v.path);
      return true;
    })
    .map(([k]) => k);
}

// ── Async fallback (scans filesystem for unknown slugs) ───────────

/**
 * Same as resolveSlugPath but falls back to scanning 10 - Projects/ for
 * unregistered slugs (backwards compatibility during migration).
 */
export async function resolveSlugPathWithFallback(slug: string): Promise<string | null> {
  const known = resolveSlugPath(slug);
  if (known) return known;

  // Fall back: check if it exists under 10 - Projects/
  const candidate = resolve(BRAIN_VAULT_ROOT, "10 - Projects", slug);
  try {
    const file = Bun.file(candidate + "/.exists-check");
    // Use stat via readdir instead
    const { readdir } = await import("node:fs/promises");
    await readdir(candidate);
    return candidate;
  } catch {
    return null;
  }
}
