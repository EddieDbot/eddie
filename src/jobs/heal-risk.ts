import type { FailureContext } from "./self-heal.ts";

export type RiskLevel = "low" | "medium" | "high";
export type CommonIssueAction = "skip_heal" | "auto_fix" | "run_migration" | "notify_only";

export type CommonIssue = {
  pattern: RegExp;
  diagnosis: string;
  action: CommonIssueAction;
};

export const COMMON_ISSUES: CommonIssue[] = [
  {
    pattern: /ECONNRESET|socket hang up/i,
    diagnosis: "Network transient error",
    action: "skip_heal",
  },
  {
    pattern: /\b503\b|\b429\b|rate.?limit/i,
    diagnosis: "Rate limit or service unavailable",
    action: "skip_heal",
  },
  {
    pattern: /SIGTTOU|state Tl/i,
    diagnosis: "Process stopped (SIGTTOU) — missing --foreground on timeout",
    action: "auto_fix",
  },
  {
    pattern: /column .* does not exist|relation .* does not exist/i,
    diagnosis: "Missing DB migration",
    action: "run_migration",
  },
  {
    pattern: /No output produced|OOM|signal 9|killed/i,
    diagnosis: "Resource pressure (OOM/kill)",
    action: "skip_heal",
  },
  {
    pattern: /OAuth 401|token expired|invalid_grant/i,
    diagnosis: "OAuth token expired — needs re-auth",
    action: "notify_only",
  },
];

export function matchCommonIssue(error: string): CommonIssue | undefined {
  return COMMON_ISSUES.find((issue) => issue.pattern.test(error));
}

export function healRiskLevel(ctx: FailureContext): RiskLevel {
  if (
    ctx.source === "heartbeat" ||
    ctx.source === "morning-brief" ||
    (ctx.outputTail?.includes("self-heal.ts") ?? false)
  ) {
    return "high";
  }
  if (ctx.steps && ctx.steps.length > 2) return "medium";
  if (ctx.source === "playlist" || ctx.source === "dream") return "low";
  return "medium";
}
