import { resolve } from "node:path";
import { STATE_DIR } from "../memory/brain-vault-paths.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

const VISION_PATH = resolve(STATE_DIR, "vision.md");

let visionCache: { text: string; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

export async function loadVision(): Promise<string> {
  if (visionCache && Date.now() - visionCache.loadedAt < CACHE_TTL_MS) {
    return visionCache.text;
  }
  try {
    const text = await Bun.file(VISION_PATH).text();
    visionCache = { text, loadedAt: Date.now() };
    return text;
  } catch {
    return "";
  }
}

export async function getCondensedVision(): Promise<string> {
  const text = await loadVision();
  if (!text) return "";
  // Extract core principles + decision framework + anti-patterns (~800 chars)
  const sections = [
    "## Core Principles",
    "## Decision Framework",
    "## Anti-Patterns",
  ];
  const parts: string[] = [];
  for (const section of sections) {
    const idx = text.indexOf(section);
    if (idx === -1) continue;
    const nextH2 = text.indexOf("\n## ", idx + 1);
    const chunk = nextH2 !== -1 ? text.slice(idx, nextH2) : text.slice(idx);
    parts.push(chunk.trim().slice(0, 300));
  }
  return parts.join("\n\n").slice(0, 800);
}

export type PreferenceSignal = {
  date: string;
  signal: string;
  context: string;
};

export async function updateVisionPreferences(
  signals: PreferenceSignal[],
): Promise<void> {
  if (!config.VISION_ENABLED || signals.length === 0) return;
  try {
    const text = await loadVision();
    const marker = "<!-- Auto-updated by EDDIE nightly";
    const idx = text.lastIndexOf(marker);
    if (idx === -1) return;
    // Find end of the section
    const endMarker = "-->";
    const endIdx = text.indexOf(endMarker, idx) + endMarker.length;
    const signalLines = signals
      .map((s) => `${s.date} | ${s.signal} | ${s.context}`)
      .join("\n");
    const newText =
      text.slice(0, endIdx) + "\n" + signalLines + text.slice(endIdx);
    visionCache = null; // invalidate cache
    await Bun.write(VISION_PATH, newText);
  } catch (err) {
    logger.warn("vision:update-prefs-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

type RoadmapItem = {
  id: string;
  description: string;
  score?: number;
  reasons?: string[];
};

async function scoreItemWithHaiku(
  item: string,
  vision: string,
): Promise<{ score: number; reasons: string[] }> {
  const prompt = `Vision summary:\n${vision}\n\nScore this roadmap item 0-10 for alignment with Nicholas's vision. Return only JSON: {"score": N, "reasons": ["reason1", "reason2"]}\n\nItem: ${item}`;
  try {
    const proc = Bun.spawn(
      [
        config.CLAUDE_PATH,
        "--model",
        "claude-haiku-4-5-20251001",
        "--print",
        "--output-format",
        "text",
        prompt,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15_000,
        env: Object.fromEntries(
          Object.entries(process.env).filter(([k]) => k !== "CLAUDECODE"),
        ) as Record<string, string>,
      },
    );
    const output = await new Response(proc.stdout).text();
    const parsed = JSON.parse(output.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as {
      score?: number;
      reasons?: string[];
    };
    return { score: parsed.score ?? 5, reasons: parsed.reasons ?? [] };
  } catch {
    return { score: 5, reasons: [] };
  }
}

export async function scoreRoadmapItem(
  description: string,
): Promise<{ score: number; reasons: string[] }> {
  const vision = await getCondensedVision();
  return scoreItemWithHaiku(description, vision);
}

export async function filterRoadmap(
  items: string[],
  topN = 10,
): Promise<RoadmapItem[]> {
  const vision = await getCondensedVision();
  const scored = await Promise.all(
    items.map(async (desc, i) => {
      const { score, reasons } = await scoreItemWithHaiku(desc, vision);
      return { id: `item-${i}`, description: desc, score, reasons };
    }),
  );
  return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, topN);
}

export async function evaluateTaskAlignment(
  taskDescription: string,
): Promise<{ aligned: boolean; score: number; reason: string }> {
  const { score, reasons } = await scoreRoadmapItem(taskDescription);
  return {
    aligned: score >= 5,
    score,
    reason:
      reasons[0] ?? (score >= 5 ? "Aligned with vision" : "Low alignment"),
  };
}
