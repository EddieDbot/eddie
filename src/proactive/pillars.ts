import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { config } from "../config.ts";

export type PillarName = string;

export async function ratePillar(
  pillar: PillarName,
  score: number,
  note?: string,
): Promise<boolean> {
  if (!memoryEnabled) return false;
  if (score < 1 || score > 10) return false;
  try {
    const { error } = await getSupabase()
      .from("pillar_ratings")
      .upsert(
        { pillar, score, note: note ?? null, rated_date: todayDate() },
        { onConflict: "pillar,rated_date" },
      );
    return !error;
  } catch {
    return false;
  }
}

export async function getTodayRatings(): Promise<
  Array<{ pillar: string; score: number; note?: string }>
> {
  if (!memoryEnabled) return [];
  try {
    const { data } = await getSupabase()
      .from("pillar_ratings")
      .select("pillar, score, note")
      .eq("rated_date", todayDate())
      .order("pillar");
    return (data ?? []).map((r) => ({
      pillar: r.pillar as string,
      score: r.score as number,
      note: (r.note as string | null) ?? undefined,
    }));
  } catch {
    return [];
  }
}

export async function getWeeklyTrend(
  pillar: string,
): Promise<Array<{ date: string; score: number }>> {
  if (!memoryEnabled) return [];
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data } = await getSupabase()
      .from("pillar_ratings")
      .select("rated_date, score")
      .eq("pillar", pillar)
      .gte("rated_date", since)
      .order("rated_date");
    return (data ?? []).map((r) => ({
      date: r.rated_date as string,
      score: r.score as number,
    }));
  } catch {
    return [];
  }
}

export async function checkNonNeg(name: string): Promise<boolean> {
  if (!memoryEnabled) return false;
  try {
    const { error } = await getSupabase()
      .from("non_negotiables")
      .upsert(
        { name, completed: true, check_date: todayDate() },
        { onConflict: "name,check_date" },
      );
    return !error;
  } catch {
    return false;
  }
}

export async function getTodayNonNegs(): Promise<
  Array<{ name: string; completed: boolean }>
> {
  if (!memoryEnabled) return [];
  try {
    const { data } = await getSupabase()
      .from("non_negotiables")
      .select("name, completed")
      .eq("check_date", todayDate())
      .order("name");
    return (data ?? []).map((r) => ({
      name: r.name as string,
      completed: r.completed as boolean,
    }));
  } catch {
    return [];
  }
}

export async function getStreaks(): Promise<Map<string, number>> {
  if (!memoryEnabled) return new Map();
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data } = await getSupabase()
      .from("non_negotiables")
      .select("name, check_date, completed")
      .gte("check_date", since)
      .eq("completed", true)
      .order("check_date", { ascending: false });

    const streaks = new Map<string, number>();
    const byName = new Map<string, string[]>();
    for (const row of data ?? []) {
      const name = row.name as string;
      const date = row.check_date as string;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name)!.push(date);
    }

    for (const [name, dates] of byName) {
      let streak = 0;
      const today = new Date();
      for (let i = 0; i < dates.length; i++) {
        const expected = new Date(today);
        expected.setDate(today.getDate() - i);
        const expectedStr = expected.toISOString().slice(0, 10);
        if (dates[i] === expectedStr) streak++;
        else break;
      }
      streaks.set(name, streak);
    }
    return streaks;
  } catch {
    return new Map();
  }
}

function todayDate(): string {
  return new Date().toLocaleDateString("sv", { timeZone: config.TIMEZONE });
}
