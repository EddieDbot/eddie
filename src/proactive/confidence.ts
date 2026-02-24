import type { Bot } from "gramio";
import { config } from "../config.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";

export type JudgmentStatus = "pending" | "approved" | "rejected" | "modified";

export type PendingJudgment = {
  id: string;
  source: string;
  originalDecision: string;
  confidence: number;
  payload?: unknown;
  createdAt: string;
};

export function parseConfidence(text: string): {
  text: string;
  confidence: number;
} {
  const match = text.match(/\[(\d+)\]/);
  if (!match) return { text, confidence: 100 };
  const confidence = parseInt(match[1]!, 10);
  const cleanText = text.replace(/\[(\d+)\]/, "").trim();
  return { text: cleanText, confidence };
}

export async function requestHumanJudgment(
  bot: Bot,
  source: string,
  decision: string,
  confidence: number,
  payload?: unknown,
): Promise<string | null> {
  if (!memoryEnabled) return null;
  try {
    const { data, error } = await getSupabase()
      .from("human_judgment")
      .insert({
        source,
        original_decision: decision,
        confidence,
        payload: payload ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !data) return null;

    const id = data.id as string;
    const summary = decision.slice(0, 80);
    await bot.api.sendMessage({
      chat_id: config.OWNER_TELEGRAM_ID,
      text: `Low confidence (${confidence}%) on ${source}: ${summary}\n\nReply /approve ${id} or /reject ${id} [reason]`,
    });
    return id;
  } catch (err) {
    logger.error("confidence:request-error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function storeJudgment(
  id: string,
  decision: "approved" | "rejected",
  feedback?: string,
  humanDecision?: string,
): Promise<boolean> {
  if (!memoryEnabled) return false;
  try {
    const { error } = await getSupabase()
      .from("human_judgment")
      .update({
        status: decision,
        human_decision: humanDecision ?? null,
        feedback: feedback ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

export type UncertaintyEscalation = {
  action: string;
  reason: string;
  threshold: number;
  chatId?: number;
};

const pendingEscalations: UncertaintyEscalation[] = [];

export function escalateUncertainty(escalation: UncertaintyEscalation): void {
  pendingEscalations.push(escalation);
}

export function getPendingEscalations(): UncertaintyEscalation[] {
  return [...pendingEscalations];
}

export function clearEscalation(index: number): void {
  pendingEscalations.splice(index, 1);
}

type ConfidenceDistribution = {
  scores: number[];
  lastUpdated: number;
};

const distribution: ConfidenceDistribution = { scores: [], lastUpdated: 0 };
const DISTRIBUTION_CACHE_MS = 3600 * 1000; // 1 hour cache

async function refreshDistribution(): Promise<void> {
  if (Date.now() - distribution.lastUpdated < DISTRIBUTION_CACHE_MS) return;

  try {
    const { getSupabase: getDb, memoryEnabled: isEnabled } =
      await import("../memory/client.ts");
    if (!isEnabled) return;

    const { data } = await getDb()
      .from("judgments")
      .select("confidence, outcome")
      .not("confidence", "is", null)
      .order("created_at", { ascending: false })
      .limit(100);

    if (data && data.length > 0) {
      distribution.scores = data
        .filter((j) => j.outcome === "approved")
        .map((j) => j.confidence as number)
        .filter((c) => typeof c === "number" && !isNaN(c));
      distribution.lastUpdated = Date.now();
    }
  } catch {}
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0.7; // fallback static threshold
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]!;
}

export async function getDynamicThreshold(): Promise<number> {
  await refreshDistribution();
  if (distribution.scores.length < 5) return 0.7; // not enough data yet
  // Use 25th percentile of approved judgments as the threshold
  // This means "we need at least as confident as the bottom 25% of past approvals"
  return percentile(distribution.scores, 25);
}

export async function isConfidentEnough(score: number): Promise<boolean> {
  const threshold = await getDynamicThreshold();
  return score >= threshold;
}

export async function getPendingJudgments(): Promise<PendingJudgment[]> {
  if (!memoryEnabled) return [];
  try {
    const { data } = await getSupabase()
      .from("human_judgment")
      .select("id, source, original_decision, confidence, payload, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10);
    return (data ?? []).map((row) => ({
      id: row.id as string,
      source: row.source as string,
      originalDecision: row.original_decision as string,
      confidence: row.confidence as number,
      payload: row.payload,
      createdAt: row.created_at as string,
    }));
  } catch {
    return [];
  }
}
