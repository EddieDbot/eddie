import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

let _embedHealthy: boolean | null = null;

export function isEmbedHealthy(): boolean | null {
  return _embedHealthy;
}

// nomic-embed-text context limit ~8192 tokens; ~4 chars/token → 6000 chars is safe
const MAX_EMBED_CHARS = 6000;

export async function embed(text: string): Promise<number[]> {
  const url = `${config.OLLAMA_URL}/api/embeddings`;
  const prompt =
    text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.EMBED_MODEL, prompt }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama embed error ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { embedding: number[] };
    if (!data.embedding || data.embedding.length === 0) {
      throw new Error("Ollama returned empty embedding");
    }
    _embedHealthy = true;
    return data.embedding;
  } catch (err) {
    _embedHealthy = false;
    const message = err instanceof Error ? err.message : String(err);
    logger.error("embed:failed", { message, url });
    throw err;
  }
}
