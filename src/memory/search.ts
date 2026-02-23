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

export async function searchMemory(
  query: string,
  matchCount = 10,
  threshold = 0.7,
): Promise<MemoryResult[]> {
  const queryEmbedding = await embed(query);
  const { data, error } = await getSupabase().rpc("search_memory", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    match_threshold: threshold,
  });
  if (error) {
    logger.error("memory:search", { error: error.message });
    return [];
  }
  return (data ?? []) as MemoryResult[];
}
