import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";

export type Expense = {
  id?: string;
  amount: number;
  currency?: string;
  category?: string;
  vendor?: string;
  description?: string;
  date?: string;
};

export async function logExpense(expense: Expense): Promise<string | null> {
  if (!config.EXPENSE_TRACKING_ENABLED || !memoryEnabled) return null;

  const { data, error } = await getSupabase()
    .from("expenses")
    .insert({
      amount: expense.amount,
      currency: expense.currency ?? "USD",
      category: expense.category,
      vendor: expense.vendor,
      description: expense.description,
      date: expense.date ?? new Date().toISOString().split("T")[0],
    })
    .select("id")
    .single();

  if (error) {
    logger.warn("expense-tracker:log-error", { error: error.message });
    return null;
  }
  return data?.id ?? null;
}

export async function getExpenseSummary(days = 30): Promise<{
  total: number;
  byCategory: Record<string, number>;
  recent: Expense[];
}> {
  if (!memoryEnabled) return { total: 0, byCategory: {}, recent: [] };

  const since = new Date(Date.now() - days * 24 * 3600 * 1000)
    .toISOString()
    .split("T")[0];
  const { data } = await getSupabase()
    .from("expenses")
    .select("amount, category, vendor, description, date")
    .gte("date", since)
    .order("date", { ascending: false });

  if (!data) return { total: 0, byCategory: {}, recent: [] };

  const total = data.reduce((sum, e) => sum + Number(e.amount), 0);
  const byCategory: Record<string, number> = {};
  for (const e of data) {
    const cat = e.category ?? "uncategorized";
    byCategory[cat] = (byCategory[cat] ?? 0) + Number(e.amount);
  }

  return { total, byCategory, recent: data.slice(0, 10) as Expense[] };
}

export function formatExpenseSummary(
  summary: Awaited<ReturnType<typeof getExpenseSummary>>,
  days = 30,
): string {
  const lines = [`Expenses (last ${days} days): $${summary.total.toFixed(2)}\n`];

  const sorted = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]);
  for (const [cat, amount] of sorted) {
    lines.push(`  ${cat}: $${amount.toFixed(2)}`);
  }

  if (summary.recent.length > 0) {
    lines.push("\nRecent:");
    for (const e of summary.recent.slice(0, 5)) {
      lines.push(
        `  ${e.date} — ${e.vendor ?? e.category ?? "misc"}: $${Number(e.amount).toFixed(2)}`,
      );
    }
  }

  return lines.join("\n");
}
