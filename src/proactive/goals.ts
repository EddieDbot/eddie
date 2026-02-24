import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";
import { runPrompt } from "../claude/run-prompt.ts";

// ── Goal tracking (existing) ────────────────────────────────────────────────

export interface Goal {
  id: string;
  title: string;
  description?: string;
  status: "active" | "completed" | "paused";
  created_at: string;
  completed_at?: string;
}

export async function listGoals(status: Goal["status"] = "active"): Promise<Goal[]> {
  const { data, error } = await getSupabase()
    .from("goals")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addGoal(title: string, description?: string): Promise<Goal> {
  const { data, error } = await getSupabase()
    .from("goals")
    .insert({ title, description, status: "active" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function completeGoal(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from("goals")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export function formatGoalsMessage(goals: Goal[]): string {
  if (goals.length === 0) return 'No active goals. Add one with `/goals add <goal>`';
  return goals
    .map((g, i) => `${i + 1}. ${g.title}${g.description ? `\n   ${g.description}` : ""}`)
    .join("\n");
}

// ── Milestone celebrations ──────────────────────────────────────────────────

function toMilestoneId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export async function isMilestoneReached(
  name: string,
): Promise<{ reached: boolean; reachedAt?: string }> {
  if (!memoryEnabled) return { reached: false };
  const id = toMilestoneId(name);
  try {
    const { data } = await getSupabase()
      .from("milestones_reached")
      .select("reached_at")
      .eq("milestone_id", id)
      .limit(1);
    if (data && data.length > 0) {
      return { reached: true, reachedAt: data[0]!.reached_at };
    }
    return { reached: false };
  } catch {
    return { reached: false };
  }
}

async function generateCelebrationMessage(
  name: string,
  description?: string,
): Promise<string> {
  const prompt = `You are EDDIE, Nicholas's AI assistant. Nicholas just hit a milestone: "${name}"${description ? ` — ${description}` : ""}.

Write a short (2-3 sentence) celebration message. Authentic, warm, direct. EDDIE's personality: laid-back but sharp, genuinely stoked for Nicholas, not cringe or over-the-top. End with one forward-looking line about what this unlocks next.

Output only the message text, no quotes, no preamble.`;

  try {
    const result = await runPrompt({ prompt, model: "claude-haiku-4-5-20251001" });
    return result.text || defaultCelebration(name);
  } catch {
    return defaultCelebration(name);
  }
}

function defaultCelebration(name: string): string {
  return `You hit it — ${name}. That's real progress. Time to set the next target and keep building.`;
}

export async function markMilestoneReached(
  name: string,
  description?: string,
): Promise<{
  alreadyReached: boolean;
  reachedAt?: string;
  message: string;
}> {
  const id = toMilestoneId(name);
  const existing = await isMilestoneReached(name);

  if (existing.reached) {
    const dateStr = existing.reachedAt
      ? new Date(existing.reachedAt).toLocaleDateString("en-US", {
          timeZone: "America/Chicago",
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "a previous date";
    return {
      alreadyReached: true,
      reachedAt: existing.reachedAt,
      message: `Already celebrated "${name}" on ${dateStr}.`,
    };
  }

  const message = await generateCelebrationMessage(name, description);

  if (memoryEnabled) {
    try {
      const { error } = await getSupabase()
        .from("milestones_reached")
        .insert({
          milestone_id: id,
          milestone_name: name,
          description: description ?? null,
          celebration_message: message,
        });
      if (error) {
        logger.warn("goals:milestone-insert-error", { error: error.message });
      }
    } catch (err) {
      logger.warn("goals:milestone-insert-catch", { error: String(err) });
    }
  }

  return { alreadyReached: false, message };
}

export async function getReachedMilestones(): Promise<
  Array<{ name: string; reachedAt: string; description?: string }>
> {
  if (!memoryEnabled) return [];
  try {
    const { data } = await getSupabase()
      .from("milestones_reached")
      .select("milestone_name, reached_at, description")
      .order("reached_at", { ascending: false });
    return (data ?? []).map((r) => ({
      name: r.milestone_name as string,
      reachedAt: r.reached_at as string,
      description: (r.description as string | null) ?? undefined,
    }));
  } catch {
    return [];
  }
}
