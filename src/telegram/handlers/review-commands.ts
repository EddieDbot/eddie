import type { MessageContext } from "./shared.ts";
import { STATE_DIR } from "../../memory/brain-vault-paths.ts";
import { runPrompt } from "../../claude/run-prompt.ts";

export async function handleApprove(context: MessageContext): Promise<void> {
  const args =
    context.text
      ?.replace(/^\/approve\s*/, "")
      .trim()
      .split(/\s+/) ?? [];
  const id = args[0];
  if (!id) {
    await context.send("Usage: /approve <judgment-id>");
    return;
  }
  const { storeJudgment } = await import("../../proactive/confidence.ts");
  const ok = await storeJudgment(id, "approved");
  await context.send(
    ok
      ? `Approved judgment ${id.slice(0, 8)}`
      : "Not found or already resolved.",
  );
}

export async function handleReject(context: MessageContext): Promise<void> {
  const args = context.text?.replace(/^\/reject\s*/, "").trim() ?? "";
  const [id, ...reasonParts] = args.split(/\s+/);
  if (!id) {
    await context.send("Usage: /reject <judgment-id> [reason]");
    return;
  }
  const reason = reasonParts.join(" ");
  const { storeJudgment } = await import("../../proactive/confidence.ts");
  const ok = await storeJudgment(id, "rejected", reason || undefined);
  await context.send(
    ok
      ? `Rejected judgment ${id.slice(0, 8)}${reason ? `: ${reason}` : ""}`
      : "Not found or already resolved.",
  );
}

export async function handleRate(context: MessageContext): Promise<void> {
  const text = context.text?.replace(/^\/rate\s*/, "").trim() ?? "";

  if (!text) {
    const { getTodayRatings } = await import("../../proactive/pillars.ts");
    const ratings = await getTodayRatings();
    if (ratings.length === 0) {
      await context.send(
        "No pillar ratings today. Use: /rate <pillar> <1-10> [note]",
      );
      return;
    }
    const lines = ratings.map(
      (r) => `${r.pillar}: ${r.score}/10${r.note ? ` — ${r.note}` : ""}`,
    );
    await context.send(`Today's ratings:\n${lines.join("\n")}`);
    return;
  }

  const parts = text.split(/\s+/);
  const pillar = parts[0]!.toLowerCase();
  const score = parseInt(parts[1] ?? "", 10);
  if (isNaN(score) || score < 1 || score > 10) {
    await context.send("Usage: /rate <pillar> <1-10> [note]");
    return;
  }
  const note = parts.slice(2).join(" ") || undefined;

  const { ratePillar } = await import("../../proactive/pillars.ts");
  const ok = await ratePillar(pillar, score, note);
  await context.send(
    ok
      ? `Logged ${pillar}: ${score}/10${note ? ` — ${note}` : ""}`
      : "Failed to save rating.",
  );
}

export async function handleNonNeg(context: MessageContext): Promise<void> {
  const text = context.text?.replace(/^\/nonneg\s*/, "").trim() ?? "";

  if (!text) {
    const { getTodayNonNegs, getStreaks } =
      await import("../../proactive/pillars.ts");
    const [items, streaks] = await Promise.all([
      getTodayNonNegs(),
      getStreaks(),
    ]);
    if (items.length === 0) {
      await context.send(
        "No non-negotiables tracked today. Use: /nonneg <item> done",
      );
      return;
    }
    const lines = items.map((item) => {
      const streak = streaks.get(item.name) ?? 0;
      const check = item.completed ? "✓" : "○";
      return `${check} ${item.name}${streak > 1 ? ` (${streak}d streak)` : ""}`;
    });
    await context.send(`Today's non-negotiables:\n${lines.join("\n")}`);
    return;
  }

  const name = text
    .replace(/\s+done$/i, "")
    .trim()
    .toLowerCase();
  const { checkNonNeg } = await import("../../proactive/pillars.ts");
  const ok = await checkNonNeg(name);
  await context.send(ok ? `✓ ${name} checked off` : "Failed to save.");
}

export async function handlePillars(context: MessageContext): Promise<void> {
  const { getTodayRatings, getTodayNonNegs, getStreaks } =
    await import("../../proactive/pillars.ts");

  const [ratings, nonNegs, streaks] = await Promise.all([
    getTodayRatings(),
    getTodayNonNegs(),
    getStreaks(),
  ]);

  const lines: string[] = ["Pillars Summary\n"];

  if (ratings.length > 0) {
    lines.push("Ratings today:");
    ratings.forEach((r) =>
      lines.push(`  ${r.pillar}: ${r.score}/10${r.note ? ` — ${r.note}` : ""}`),
    );
  } else {
    lines.push("No ratings today.");
  }

  lines.push("");
  if (nonNegs.length > 0) {
    lines.push("Non-negotiables:");
    nonNegs.forEach((item) => {
      const streak = streaks.get(item.name) ?? 0;
      const check = item.completed ? "✓" : "○";
      lines.push(`  ${check} ${item.name}${streak > 1 ? ` (${streak}d)` : ""}`);
    });
  } else {
    lines.push("No non-negotiables tracked.");
  }

  await context.send(lines.join("\n"));
}

export async function handleReview(context: MessageContext): Promise<void> {
  const { startWeeklyReview } =
    await import("../../proactive/weekly-review.ts");
  const bot = (context as unknown as { bot: import("gramio").Bot }).bot;
  await startWeeklyReview(context.chat.id, bot);
}

export async function handleAlign(context: MessageContext): Promise<void> {
  const idea = context.text?.replace(/^\/align\s*/, "").trim();
  if (!idea) {
    await context.send("Usage: /align <idea or project>");
    return;
  }
  try {
    const visionPath = `${STATE_DIR}/vision.md`;
    let vision = "";
    try {
      vision = await Bun.file(visionPath).text();
      vision = vision.slice(0, 2000);
    } catch {}

    const { text, ok } = await runPrompt({
      system: vision
        ? `You are an alignment advisor. Score how well an idea aligns with this vision:\n\n${vision}\n\nReply with: Score: X/100\n[2-3 sentence reasoning]`
        : "You are an alignment advisor. Score how well the idea aligns with a creative technologist/director's vision. Reply with: Score: X/100\n[2-3 sentence reasoning]",
      prompt: `Idea: ${idea}`,
      model: "claude-haiku-4-5-20251001",
    });
    await context.send(ok && text ? text : "Could not score.");
  } catch {
    await context.send("Align check failed.");
  }
}
