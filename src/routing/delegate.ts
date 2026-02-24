import type { ModelId } from "../jobs/types.ts";
import { matchDelegationRules } from "./model-kb.ts";
import { classifySource, TrustLevel } from "../security/trust.ts";
import { config } from "../config.ts";

export type DelegationDecision = {
  shouldDelegate: boolean;
  targetModel?: ModelId;
  reason: string;
  confidence: number;
};

const DELEGATION_THRESHOLD = 0.7;
const MAX_LEAF_PROMPT_LENGTH = 2000;

const SENSITIVE_PATTERNS = [
  /password|credential|secret|api.?key|token|auth/i,
  /ssh|sudo|rm -rf|format|wipe/i,
  /bank|payment|credit.?card|ssn|social.?security/i,
  /personal.?data|pii|gdpr/i,
];

export function isSensitivePrompt(prompt: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(prompt));
}

const RESEARCH_PATTERNS = [
  /\b(research|analyze|compare|investigate|study|survey|review)\b.*\b(market|industry|competitor|trend|landscape)\b/i,
  /\bwhat is the (current|latest|state of)\b/i,
  /\bsummarize.*recent\b/i,
  /\bfind.*information about\b/i,
];

export function isResearchHeavyTask(prompt: string): boolean {
  if (!config.CROSS_PROVIDER_ROUTING_ENABLED) return false;
  return RESEARCH_PATTERNS.some((p) => p.test(prompt));
}

const DETERMINISTIC_PATTERNS = [
  /^(calculate|compute|convert|parse|format)\s+/i,
];

export function isDeterministicTask(prompt: string): boolean {
  return (
    prompt.length < 200 && DETERMINISTIC_PATTERNS.some((p) => p.test(prompt))
  );
}

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
  if (isDeterministicTask(prompt)) {
    return {
      shouldDelegate: true,
      targetModel: "claude" as ModelId,
      reason: "deterministic task — minimal context needed",
      confidence: 0.9,
    };
  }

  if (isSensitivePrompt(prompt)) {
    return {
      shouldDelegate: false,
      reason: "sensitive content — Claude only",
      confidence: 1,
    };
  }

  if (isResearchHeavyTask(prompt)) {
    return {
      shouldDelegate: true,
      targetModel: "gemini" as ModelId,
      reason: "research task — routing to Gemini for web search",
      confidence: 0.75,
    };
  }

  if (!isLeafTask(prompt)) {
    return {
      shouldDelegate: false,
      reason: "multi-step task, keeping on Claude",
      confidence: 0,
    };
  }

  const matches = matchDelegationRules(prompt);

  if (matches.length === 0) {
    return {
      shouldDelegate: false,
      reason: "no specialist match",
      confidence: 0,
    };
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
