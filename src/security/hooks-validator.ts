import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const SETTINGS_PATH = resolve(HOME, ".claude/settings.json");

// Approved hook script paths (prefix whitelist)
const APPROVED_HOOK_PREFIXES = [
  resolve(HOME, ".claude/scripts/hooks/"),
  resolve(HOME, ".claude/skills/"),
  resolve(HOME, "eddie/"),
];

type HookCommand = {
  type?: string;
  command?: string;
  [key: string]: unknown;
};

type HookGroup = {
  matcher?: string;
  hooks?: HookCommand[];
  command?: string;
  [key: string]: unknown;
};

type HooksConfig = {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
};

export type HookValidationResult = {
  valid: boolean;
  suspicious: string[];
  approved: number;
};

function isApprovedCommand(cmd: string): boolean {
  return (
    APPROVED_HOOK_PREFIXES.some(prefix => cmd.includes(prefix)) ||
    cmd.startsWith("node ") ||
    cmd.startsWith("bun ") ||
    cmd.startsWith("echo ")
  );
}

export async function validateHooks(): Promise<HookValidationResult> {
  const suspicious: string[] = [];
  let approved = 0;

  try {
    const raw = await Bun.file(SETTINGS_PATH).text();
    const settings = JSON.parse(raw) as HooksConfig;
    const hooks = settings.hooks ?? {};

    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        // Claude settings.json format: { matcher, hooks: [{ type, command }] }
        const commands = group.hooks ?? [];
        for (const entry of commands) {
          const cmd = entry.command ?? "";
          if (!cmd) continue;
          if (isApprovedCommand(cmd)) {
            approved++;
          } else {
            suspicious.push(`[${event}] ${cmd.slice(0, 100)}`);
          }
        }
        // Also handle flat { command } at group level (fallback)
        const flatCmd = group.command ?? "";
        if (flatCmd) {
          if (isApprovedCommand(flatCmd)) {
            approved++;
          } else {
            suspicious.push(`[${event}:flat] ${flatCmd.slice(0, 100)}`);
          }
        }
      }
    }
  } catch (err) {
    logger.warn("hooks-validator:read-error", { error: String(err) });
    return { valid: true, suspicious: [], approved: 0 };
  }

  if (suspicious.length > 0) {
    logger.warn("hooks-validator:suspicious-hooks", { suspicious });
  }

  return { valid: suspicious.length === 0, suspicious, approved };
}
