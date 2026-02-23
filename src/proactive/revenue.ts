import { getSupabase } from "../memory/client.ts";

export interface RevenueEntry {
  id: string;
  amount: number;
  currency: string;
  source: string;
  description?: string;
  date: string;
  created_at: string;
}

export interface RevenueSummary {
  totalMRR: number;
  totalAllTime: number;
  entries: RevenueEntry[];
  currency: string;
}

export async function addRevenueEntry(
  amount: number,
  source: string,
  description?: string,
  date?: string,
): Promise<RevenueEntry> {
  const { data, error } = await getSupabase()
    .from("revenue_entries")
    .insert({
      amount,
      currency: "USD",
      source,
      description,
      date: date ?? new Date().toISOString().split("T")[0],
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getRevenueSummary(): Promise<RevenueSummary> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data, error } = await getSupabase()
    .from("revenue_entries")
    .select("*")
    .order("date", { ascending: false })
    .limit(50);

  if (error) throw error;
  const entries = data ?? [];

  const mrrEntries = entries.filter((e) => new Date(e.date) >= thirtyDaysAgo);
  const totalMRR = mrrEntries.reduce((sum, e) => sum + e.amount, 0);
  const totalAllTime = entries.reduce((sum, e) => sum + e.amount, 0);

  return {
    totalMRR,
    totalAllTime,
    entries: entries.slice(0, 10),
    currency: "USD",
  };
}

export function formatRevenueSummary(summary: RevenueSummary): string {
  const { totalMRR, totalAllTime, entries } = summary;
  let msg = `*Revenue*\n\n`;
  msg += `Last 30 days: $${totalMRR.toFixed(2)}\n`;
  msg += `All time: $${totalAllTime.toFixed(2)}\n\n`;
  if (entries.length > 0) {
    msg += `*Recent Entries:*\n`;
    for (const e of entries.slice(0, 5)) {
      msg += `• ${e.date}: $${e.amount} — ${e.source}`;
      if (e.description) msg += ` (${e.description})`;
      msg += "\n";
    }
  }
  return msg;
}
