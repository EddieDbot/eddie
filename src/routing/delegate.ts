import type { ModelId } from "../jobs/types.ts";
import { matchDelegationRules } from "./model-kb.ts";

export type DelegationDecision = {
  shouldDelegate: boolean;
  targetModel?: ModelId;
  reason: string;
  confidence: number;
};

const DELEGATION_THRESHOLD = 0.7;
const MAX_LEAF_PROMPT_LENGTH = 2000;

export function isLeafTask(prompt: string): boolean {
  if (prompt.length > MAX_LEAF_PROMPT_LENGTH) return false;

  const multiStepSignals = [
    /step \d+/i,
    /then.*then/i,
    /\bfirst\b.*\bthen\b/i,
    /multiple.*tasks/i,
    /brain vault/i,
    /write.*to.*file/i,
    /save.*to/i,
    /read.*file/i,
    /check.*status/i,
    /run.*command/i,
  ];

  for (const signal of multiStepSignals) {
    if (signal.test(prompt)) return false;
  }

  return true;
}

export function evaluateDelegation(prompt: string): DelegationDecision {
  if (!isLeafTask(prompt)) {
    return { shouldDelegate: false, reason: "multi-step task, keeping on Claude", confidence: 0 };
  }

  const matches = matchDelegationRules(prompt);

  if (matches.length === 0) {
    return { shouldDelegate: false, reason: "no specialist match", confidence: 0 };
  }

  const best = matches[0]!;

  if (best.score < DELEGATION_THRESHOLD) {
    return {
      shouldDelegate: false,
      reason: `best match ${best.rule.id} score ${best.score.toFixed(2)} below threshold`,
      confidence: best.score,
    };
  }

  return {
    shouldDelegate: true,
    targetModel: best.rule.bestModel,
    reason: `${best.rule.id} (score: ${best.score.toFixed(2)})`,
    confidence: best.score,
  };
}
