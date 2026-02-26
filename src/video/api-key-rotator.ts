import { logger } from "../utils/logger.ts";
import { config } from "../config.ts";

const QUOTA_PER_UPLOAD = 1600; // YouTube Data API units per upload
const QUOTA_LIMIT = 9000;      // rotate when we approach 10k daily limit

interface ProjectCredentials {
  projectPath: string;  // path to youtube-tokens-{n}.json
  quotaUsed: number;
  lastReset: string; // YYYY-MM-DD
}

// In-memory state — resets on service restart (which is fine, daily quota resets too)
const projectState = new Map<string, ProjectCredentials>();

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function initKeyRotator(): void {
  if (!config.YOUTUBE_API_PROJECTS) return;
  const paths = config.YOUTUBE_API_PROJECTS.split(",").map(s => s.trim()).filter(Boolean);
  for (const p of paths) {
    projectState.set(p, { projectPath: p, quotaUsed: 0, lastReset: todayStr() });
  }
  logger.info("api-key-rotator:init", { projectCount: paths.length });
}

export function getNextAvailableProject(): string | null {
  const today = todayStr();
  for (const [path, state] of projectState) {
    // Reset if new day
    if (state.lastReset !== today) {
      state.quotaUsed = 0;
      state.lastReset = today;
    }
    if (state.quotaUsed + QUOTA_PER_UPLOAD < QUOTA_LIMIT) {
      return path;
    }
  }
  return null; // all projects at quota
}

export function recordUploadQuotaUsage(projectPath: string): void {
  const state = projectState.get(projectPath);
  if (state) {
    state.quotaUsed += QUOTA_PER_UPLOAD;
    logger.info("api-key-rotator:usage", { projectPath, quotaUsed: state.quotaUsed });
  }
}
