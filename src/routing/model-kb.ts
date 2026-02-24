import type { ModelId } from "../jobs/types.ts";

export type DelegationRule = {
  id: string;
  bestModel: ModelId;
  patterns: RegExp[];
  leafOnly: boolean;
  confidence: number;
};

export const DELEGATION_RULES: DelegationRule[] = [
  {
    id: "math-reasoning",
    bestModel: "codex",
    patterns: [/math problem/i, /\baime\b/i, /proof/i, /logic puzzle/i, /equation/i, /calculus/i, /competition math/i],
    leafOnly: true,
    confidence: 0.85,
  },
  {
    id: "large-context",
    bestModel: "gemini",
    patterns: [/entire codebase/i, /whole repo/i, /1m context/i, /cross.reference.*repo/i, /all files/i],
    leafOnly: true,
    confidence: 0.9,
  },
  {
    id: "visual-to-code",
    bestModel: "kimi",
    patterns: [/screenshot to code/i, /ui from image/i, /design to code/i, /image to.*component/i],
    leafOnly: true,
    confidence: 0.95,
  },
  {
    id: "chinese",
    bestModel: "kimi",
    patterns: [/\bchinese\b/i, /中文/, /\bmandarin\b/i, /translate.*chinese/i],
    leafOnly: true,
    confidence: 1.0,
  },
  {
    id: "cost-batch",
    bestModel: "kimi",
    patterns: [/bulk process/i, /batch job/i, /high volume/i, /cost.sensitive/i, /cheap.*api/i],
    leafOnly: false,
    confidence: 0.8,
  },
  {
    id: "rapid-mvp",
    bestModel: "gemini",
    patterns: [/quick prototype/i, /fast mvp/i, /first draft/i, /rough version/i],
    leafOnly: true,
    confidence: 0.7,
  },
  {
    id: "video-analysis",
    bestModel: "gemini",
    patterns: [/analyze video/i, /video recording/i, /watch.*video/i, /video.*timestamp/i],
    leafOnly: true,
    confidence: 0.95,
  },
  {
    id: "execution-phase",
    bestModel: "kimi",
    patterns: [/implement this plan/i, /execute the plan/i, /just code it/i, /write the code for/i],
    leafOnly: false,
    confidence: 0.75,
  },
  {
    id: "general-reasoning",
    bestModel: "gemini",
    patterns: [/explain.*detail/i, /compare.*options/i, /pros and cons/i, /analyze.*tradeoffs/i],
    leafOnly: true,
    confidence: 0.65,
  },
  {
    id: "code-completion",
    bestModel: "codex",
    patterns: [/complete this code/i, /fill in.*function/i, /implement.*algorithm/i, /code.*solution/i],
    leafOnly: true,
    confidence: 0.8,
  },
];

export type RuleMatch = {
  rule: DelegationRule;
  score: number;
};

export function matchDelegationRules(prompt: string): RuleMatch[] {
  const matches: RuleMatch[] = [];

  for (const rule of DELEGATION_RULES) {
    let matchCount = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(prompt)) matchCount++;
    }
    if (matchCount > 0) {
      const score = rule.confidence * (matchCount / rule.patterns.length);
      matches.push({ rule, score });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

export function buildDelegationGuidance(): string {
  const rules = DELEGATION_RULES.map(r =>
    `- ${r.id}: delegate leaf sub-tasks to ${r.bestModel} when prompt matches: ${r.patterns.slice(0, 3).map(p => p.source).join(", ")}`
  ).join("\n");

  return `## Multi-Model Delegation
When you encounter a sub-task that clearly maps to a specialist model, you MAY delegate it via the Task tool.
Only delegate LEAF tasks (self-contained, no EDDIE context needed, <2000 chars).
Never delegate tasks that require EDDIE's system context, tool access, or Brain Vault.

Specialist models and their strengths:
- codex: math reasoning, code completion, algorithmic problems
- gemini: large context (whole repo), video analysis, rapid prototyping
- kimi: UI from screenshot, Chinese language, bulk/batch processing

Delegation patterns:
${rules}

To delegate: spawn a Task tool with the specialist model's CLI. Results come back inline.
If unsure, keep the task on Claude — don't over-delegate.`;
}
