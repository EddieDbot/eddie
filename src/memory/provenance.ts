import { getSupabase, memoryEnabled } from "./client.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

export type ProvenanceEntry = {
  feature_name: string;
  source_type: string; // "video" | "book" | "transcript" | "session" | "manual" | "agent"
  source_ref?: string; // YouTube ID, book slug, etc.
  source_title?: string;
  job_id?: string;
  agent?: string;
  status?: string; // "shipped" | "in-progress" | "planned"
  notes?: string;
};

export async function logProvenance(entry: ProvenanceEntry): Promise<void> {
  if (!memoryEnabled || !config.PROVENANCE_ENABLED) return;
  try {
    const { error } = await getSupabase()
      .from("provenance_log")
      .insert({ status: "shipped", ...entry });
    if (error) logger.warn("provenance:log-error", { error: error.message });
  } catch (err) {
    logger.warn("provenance:log-failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export type ProvenanceSummary = {
  bySourceType: Record<string, number>;
  recent: Array<{ feature_name: string; source_title?: string; source_type: string; created_at: string }>;
};

const EMPTY_SUMMARY: ProvenanceSummary = { bySourceType: {}, recent: [] };

export async function getRecentProvenance(days = 7): Promise<Array<{ feature_name: string; source_title?: string; source_type: string; created_at: string }>> {
  if (!memoryEnabled) return [];
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    const { data, error } = await getSupabase()
      .from("provenance_log")
      .select("feature_name, source_title, source_type, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}

export async function getProvenanceSummary(days = 7): Promise<ProvenanceSummary> {
  if (!memoryEnabled) return EMPTY_SUMMARY;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    const { data, error } = await getSupabase()
      .from("provenance_log")
      .select("feature_name, source_title, source_type, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    if (error || !data) return EMPTY_SUMMARY;
    const bySourceType: Record<string, number> = {};
    for (const row of data) {
      bySourceType[row.source_type] = (bySourceType[row.source_type] ?? 0) + 1;
    }
    return { bySourceType, recent: data.slice(0, 5) };
  } catch {
    return EMPTY_SUMMARY;
  }
}

export async function formatProvenanceSummary(days = 7): Promise<string> {
  const summary = await getProvenanceSummary(days);
  if (summary.recent.length === 0) return "";
  const byType = Object.entries(summary.bySourceType)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => `  ${type}: ${count}`)
    .join("\n");
  const recent = summary.recent
    .map((r) => `- ${r.feature_name}${r.source_title ? ` (from: ${r.source_title})` : ""}`)
    .join("\n");
  return `By source:\n${byType}\nRecently shipped:\n${recent}`;
}
