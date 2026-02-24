import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";

export type Commitment = {
  id?: string;
  description: string;
  waitingOn?: string;
  dueDate?: string;
  project?: string;
  status?: "pending" | "fulfilled" | "cancelled";
};

export async function addCommitment(
  c: Omit<Commitment, "id" | "status">,
): Promise<string | null> {
  if (!config.COMMITMENT_TRACKING_ENABLED || !memoryEnabled) return null;

  const { data, error } = await getSupabase()
    .from("commitments")
    .insert({
      description: c.description,
      waiting_on: c.waitingOn,
      due_date: c.dueDate,
      project: c.project,
    })
    .select("id")
    .single();

  if (error) {
    logger.warn("waiting-on:add-error", { error: error.message });
    return null;
  }
  return data?.id ?? null;
}

export async function fulfillCommitment(id: string): Promise<boolean> {
  if (!memoryEnabled) return false;
  const { error } = await getSupabase()
    .from("commitments")
    .update({ status: "fulfilled", fulfilled_at: new Date().toISOString() })
    .eq("id", id);
  return !error;
}

export async function getPendingCommitments(): Promise<Commitment[]> {
  if (!memoryEnabled) return [];
  const { data } = await getSupabase()
    .from("commitments")
    .select("id, description, waiting_on, due_date, project, status")
    .eq("status", "pending")
    .order("due_date", { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id as string,
    description: r.description as string,
    waitingOn: (r.waiting_on as string | null) ?? undefined,
    dueDate: (r.due_date as string | null) ?? undefined,
    project: (r.project as string | null) ?? undefined,
    status: r.status as "pending",
  }));
}
