import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { embed } from "./embed.ts";

export const memoryEnabled = !!(
  config.SUPABASE_URL &&
  config.SUPABASE_ANON_KEY
);

let _supabase: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY)
      throw new Error("Supabase not configured");
    _supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  }
  return _supabase;
}

export async function checkEmbeddingHealth(): Promise<boolean> {
  try {
    await embed("health check");
    logger.info("memory:embed-healthy", { status: "ok", provider: "ollama" });
    return true;
  } catch {
    logger.warn("memory:embed-unhealthy", {
      impact: "memory search/store/context-injection all disabled",
      fix: "ensure Ollama is running: systemctl --user start ollama",
    });
    return false;
  }
}
