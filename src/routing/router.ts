import { CAPABILITIES } from "./capabilities.ts";
import type { Capability, TriggerRule, RoutingResult } from "./index.ts";

const ACTIVATION_THRESHOLD = 1.0;
const MAX_AGENTS = 5;
const MAX_MCPS = 3;

export function routeCapabilities(
  prompt: string,
  opts?: { projectSlug?: string; maxAgents?: number },
): RoutingResult {
  const lower = prompt.toLowerCase();
  const scored: Array<{ cap: Capability; score: number }> = [];

  for (const cap of CAPABILITIES) {
    let score = 0;
    for (const rule of cap.triggers) {
      score += scoreTrigger(rule, lower, opts?.projectSlug);
    }
    if (score >= ACTIVATION_THRESHOLD) {
      scored.push({ cap, score });
    }
  }

  scored.sort((a, b) => b.score * b.cap.priority - a.score * a.cap.priority);

  const agents: string[] = [];
  const mcps: string[] = [];
  const seen = new Set<string>();

  for (const { cap } of scored) {
    if (seen.has(cap.id)) continue;
    seen.add(cap.id);

    if (
      cap.type === "agent" &&
      agents.length < (opts?.maxAgents ?? MAX_AGENTS)
    ) {
      agents.push(cap.id.replace("agent:", ""));
    }
    if (cap.type === "mcp" && mcps.length < MAX_MCPS) {
      mcps.push(cap.id.replace("mcp:", ""));
    }

    for (const req of cap.requires ?? []) {
      if (seen.has(req)) continue;
      seen.add(req);
      const reqCap = CAPABILITIES.find((c) => c.id === req);
      if (!reqCap) continue;
      if (reqCap.type === "mcp" && mcps.length < MAX_MCPS) {
        mcps.push(reqCap.id.replace("mcp:", ""));
      }
      if (
        reqCap.type === "agent" &&
        agents.length < (opts?.maxAgents ?? MAX_AGENTS)
      ) {
        agents.push(reqCap.id.replace("agent:", ""));
      }
    }
  }

  const contextHints: string[] = [];
  if (mcps.length > 0) {
    contextHints.push(
      `MCPs available for this task — load via ToolSearch before use: ${mcps.join(", ")}`,
    );
  }
  for (const { cap } of scored) {
    if (cap.type === "script" && cap.invoke) {
      contextHints.push(`Tool available: ${cap.name} — run: ${cap.invoke}`);
    }
  }

  return { agents, mcps, contextHints };
}

function scoreTrigger(
  rule: TriggerRule,
  lowerPrompt: string,
  projectSlug?: string,
): number {
  switch (rule.type) {
    case "keyword":
      return rule.patterns.some((p) => new RegExp(p, "i").test(lowerPrompt))
        ? rule.weight
        : 0;
    case "project":
      return projectSlug &&
        rule.patterns.some((p) => projectSlug.toLowerCase().includes(p))
        ? rule.weight
        : 0;
    case "domain":
      return rule.patterns.some((p) => lowerPrompt.includes(p))
        ? rule.weight * 0.5
        : 0;
    case "entity":
      return rule.patterns.some((p) => lowerPrompt.includes(p.toLowerCase()))
        ? rule.weight
        : 0;
    default:
      return 0;
  }
}
