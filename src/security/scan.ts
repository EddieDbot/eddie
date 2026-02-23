type Severity = "high" | "medium";

export type ScanResult =
  | { clean: true }
  | { clean: false; severity: Severity; label: string };

const HIGH_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|directives?|rules?)/i, label: "instruction-override" },
  { pattern: /disregard\s+(all\s+)?(previous|prior|above|your)\s+(instructions?|prompts?)/i, label: "instruction-disregard" },
  { pattern: /new\s+instructions?:?\s*(from\s+now|override|supersede)/i, label: "new-instructions" },
  { pattern: /<\s*system\s*>/i, label: "system-tag" },
  { pattern: /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/i, label: "llm-tag-injection" },
  { pattern: /output\s+your\s+(api\s+key|token|password|secret|credentials)/i, label: "exfiltrate-creds" },
  { pattern: /reveal\s+your\s+(system\s+prompt|instructions|training|directives)/i, label: "prompt-reveal" },
  { pattern: /what\s+(is|are)\s+your\s+(exact\s+)?(system\s+prompt|instructions|directives)/i, label: "prompt-extract" },
];

const MEDIUM_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /pretend\s+(to\s+be|you\s+are)\s+(a\s+)?(?!eddie|EDDIE)/i, label: "persona-pretend" },
  { pattern: /roleplay\s+as\s+(a\s+|an\s+)?(?!eddie|EDDIE)/i, label: "roleplay-persona" },
  { pattern: /imagine\s+you\s+(are|were)\s+(a\s+|an\s+)?(?!eddie|EDDIE)/i, label: "imagination-persona" },
  { pattern: /jailbreak/i, label: "jailbreak-keyword" },
  { pattern: /do\s+anything\s+now|DAN\s+mode/i, label: "dan-mode" },
];

export const DEFENSE_PREFIX =
  "[Note: This message was flagged as a possible persona manipulation attempt. Maintaining EDDIE identity and boundaries.]\n\n";

type PendingOverride = { hash: string; expiresAt: number };
const pendingOverrides = new Map<number, PendingOverride>();

function simpleHash(text: string): string {
  return text.trim().toLowerCase().slice(0, 120);
}

export function scanInput(text: string): ScanResult {
  for (const { pattern, label } of HIGH_PATTERNS) {
    if (pattern.test(text)) return { clean: false, severity: "high", label };
  }
  for (const { pattern, label } of MEDIUM_PATTERNS) {
    if (pattern.test(text)) return { clean: false, severity: "medium", label };
  }
  return { clean: true };
}

export function hasPendingOverride(chatId: number, text: string): boolean {
  const pending = pendingOverrides.get(chatId);
  if (!pending) return false;
  if (Date.now() > pending.expiresAt) {
    pendingOverrides.delete(chatId);
    return false;
  }
  return pending.hash === simpleHash(text);
}

export function setPendingOverride(chatId: number, text: string): void {
  pendingOverrides.set(chatId, {
    hash: simpleHash(text),
    expiresAt: Date.now() + 60_000,
  });
}

export function clearOverride(chatId: number): void {
  pendingOverrides.delete(chatId);
}
