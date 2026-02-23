import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logCommunication } from "../memory/store.ts";
import { logger } from "../utils/logger.ts";

const MAX_PER_DAY = 3;
const MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;

const inProcessLog: { timestamp: number }[] = [];

export async function canSendProactive(): Promise<boolean> {
  if (!memoryEnabled) {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const recent = inProcessLog.filter((e) => e.timestamp > dayAgo);
    if (recent.length >= MAX_PER_DAY) return false;
    const last = recent[recent.length - 1];
    if (last && now - last.timestamp < MIN_INTERVAL_MS) return false;
    return true;
  }

  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await getSupabase()
      .from("communication_log")
      .select("created_at")
      .eq("channel", "proactive")
      .eq("direction", "outbound")
      .gte("created_at", dayAgo)
      .order("created_at", { ascending: false });

    if (error) {
      logger.error("proactive:anti-spam-query", { error: error.message });
      return false;
    }

    const entries = data ?? [];
    if (entries.length >= MAX_PER_DAY) return false;
    if (entries.length > 0) {
      const lastSent = new Date(entries[0]!.created_at).getTime();
      if (Date.now() - lastSent < MIN_INTERVAL_MS) return false;
    }
    return true;
  } catch (err) {
    logger.error("proactive:anti-spam", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export async function logProactiveSend(summary: string): Promise<void> {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  // Prune entries older than 24h
  while (inProcessLog.length > 0 && inProcessLog[0]!.timestamp < dayAgo) {
    inProcessLog.shift();
  }
  inProcessLog.push({ timestamp: now });
  if (memoryEnabled) {
    await logCommunication("proactive", "outbound", summary);
  }
}
