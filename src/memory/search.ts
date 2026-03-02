import { getSupabase } from "./client.ts";
import { embed } from "./embed.ts";
import { logger } from "../utils/logger.ts";

export type MemoryResult = {
  source: string;
  id: string;
  content: string;
  category: string | null;
  similarity: number;
  created_at: string;
};

export type MemorySearchMode = "hybrid" | "semantic" | "keyword";

export async function searchMemory(
  query: string,
  matchCount = 10,
  threshold = 0.7,
  mode: MemorySearchMode = "hybrid",
): Promise<MemoryResult[]> {
  const results: MemoryResult[] = [];

  if (mode === "semantic" || mode === "hybrid") {
    const queryEmbedding = await embed(query);
    const { data, error } = await getSupabase().rpc("search_memory", {
      query_embedding: queryEmbedding,
      match_count: matchCount,
      match_threshold: threshold,
    });
    if (error) {
      logger.error("memory:search:semantic", { error: error.message });
    } else {
      results.push(...((data ?? []) as MemoryResult[]));
    }
  }

  if (mode === "keyword" || mode === "hybrid") {
    const { data, error } = await getSupabase().rpc("search_memory_fulltext", {
      query_text: query,
      match_count: matchCount,
    });
    if (error) {
      logger.error("memory:search:fulltext", { error: error.message });
    } else {
      results.push(...((data ?? []) as MemoryResult[]));
    }
  }

  // Deduplicate by id, taking highest similarity score
  const seen = new Map<string, MemoryResult>();
  for (const r of results) {
    const existing = seen.get(r.id);
    if (!existing || r.similarity > existing.similarity) {
      seen.set(r.id, r);
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, matchCount);
}
