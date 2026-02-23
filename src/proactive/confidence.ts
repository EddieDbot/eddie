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

export function parseConfidence(text: string): { text: string; confidence: number } {
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
