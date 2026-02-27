import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const DATA_DIR = resolve(import.meta.dir, "../../data");
const STATS_PATH = resolve(DATA_DIR, "heimdall-stats.json");

interface PieceUsage {
  id: string;
  name: string;
  lastUsed: string;
  useCount: number;
}

interface LocalStats {
  pieces: PieceUsage[];
  lastReported?: string;
}

async function loadStats(): Promise<LocalStats> {
  try {
    const content = await Bun.file(STATS_PATH).text();
    return JSON.parse(content) as LocalStats;
  } catch {
    return { pieces: [] };
  }
}

async function saveStats(stats: LocalStats): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await Bun.write(STATS_PATH, JSON.stringify(stats, null, 2));
}

export async function recordUsage(
  pieceId: string,
  pieceName: string,
): Promise<void> {
  const stats = await loadStats();
  const existing = stats.pieces.find((p) => p.id === pieceId);

  if (existing) {
    existing.useCount++;
    existing.lastUsed = new Date().toISOString();
  } else {
    stats.pieces.push({
      id: pieceId,
      name: pieceName,
      lastUsed: new Date().toISOString(),
      useCount: 1,
    });
  }

  await saveStats(stats);
}

export async function getStats(): Promise<LocalStats> {
  return loadStats();
}

function formatStats(stats: LocalStats): string {
  if (stats.pieces.length === 0) {
    return "No piece usage recorded yet.";
  }

  const lines: string[] = ["Local Piece Usage:\n"];

  const sorted = [...stats.pieces].sort(
    (a, b) => b.useCount - a.useCount,
  );
  for (const piece of sorted) {
    const date = new Date(piece.lastUsed).toLocaleDateString();
    lines.push(
      `  ${piece.name} (${piece.id}) — ${piece.useCount} uses, last: ${date}`,
    );
  }

  lines.push(`\nTotal: ${stats.pieces.length} piece(s) tracked.`);

  if (stats.lastReported) {
    lines.push(
      `Last reported: ${new Date(stats.lastReported).toLocaleString()}`,
    );
  } else {
    lines.push("Never reported to community dashboard.");
  }

  return lines.join("\n");
}

// CLI entry point
if (import.meta.main) {
  const stats = await getStats();
  console.log(formatStats(stats));
}
