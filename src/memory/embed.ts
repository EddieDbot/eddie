import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

let _embedHealthy: boolean | null = null;

export function isEmbedHealthy(): boolean | null {
  return _embedHealthy;
}

// Google text-embedding-004: 2048 token limit; ~4 chars/token → 8000 chars is safe
// Ollama nomic-embed-text: ~8192 token limit → 6000 chars is safe
const MAX_EMBED_CHARS = 6000;

async function embedGoogle(text: string): Promise<number[]> {
  const apiKey = config.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not set");

  const model = config.GOOGLE_EMBED_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality: config.GOOGLE_EMBED_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google embed error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { embedding?: { values: number[] } };
  const values = data.embedding?.values;
  if (!values || values.length === 0)
    throw new Error("Google returned empty embedding");
  return values;
}

async function embedOllama(text: string): Promise<number[]> {
  const url = `${config.OLLAMA_URL}/api/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama embed error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { embedding: number[] };
  if (!data.embedding || data.embedding.length === 0)
    throw new Error("Ollama returned empty embedding");
  return data.embedding;
}

export async function embed(text: string): Promise<number[]> {
  const input =
    text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;
  try {
    let result: number[];
    if (config.EMBED_PROVIDER === "google") {
      result = await embedGoogle(input);
    } else {
      result = await embedOllama(input);
    }
    _embedHealthy = true;
    return result;
  } catch (err) {
    _embedHealthy = false;
    const message = err instanceof Error ? err.message : String(err);
    logger.error("embed:failed", { message, provider: config.EMBED_PROVIDER });
    throw err;
  }
}
