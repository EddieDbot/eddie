import { getSupabase } from "../memory/client.ts";

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
