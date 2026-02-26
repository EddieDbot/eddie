// Stub: AI video generation clients (Sora, Runway, Kling, Hailuo)
// Not buildable yet — API access + pricing research required
// Interface defined here for when we're ready to implement

export type AIVideoProvider = "sora" | "runway" | "kling" | "hailuo";

export interface AIVideoRenderer {
  provider: AIVideoProvider;
  costPerSecond: number; // USD
  maxDurationSec: number;
  generateClip(prompt: string, durationSec: number): Promise<string>; // returns local file path
}

export interface AIVideoScript {
  visualPrompt: string;        // what to show on screen
  styleHints: string[];        // e.g. ["dark", "tech", "minimal"]
  durationSec: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
}

// Provider cost estimates (as of 2026-02)
export const PROVIDER_COSTS: Record<AIVideoProvider, { costPerSecond: number; notes: string }> = {
  sora:   { costPerSecond: 0.08,  notes: "OpenAI Sora — not yet available via API" },
  runway: { costPerSecond: 0.05,  notes: "Runway Gen-3 — $0.05/sec at standard tier" },
  kling:  { costPerSecond: 0.035, notes: "Kling 1.5 — Chinese provider, quality improving fast" },
  hailuo: { costPerSecond: 0.04,  notes: "Hailuo MiniMax — fast generation, competitive quality" },
};

// TODO: Implement when API access obtained
// Priority order: kling (cost) → hailuo (speed) → runway (quality) → sora (TBD)
