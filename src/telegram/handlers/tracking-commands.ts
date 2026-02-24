import type { MessageContext } from "./shared.ts";
import {
  logExpense,
  getExpenseSummary,
  formatExpenseSummary,
} from "../../proactive/expense-tracker.ts";
import {
  addCommitment,
  fulfillCommitment,
  getPendingCommitments,
} from "../../proactive/waiting-on-tracker.ts";

export async function handleSpending(context: MessageContext): Promise<void> {
  const arg = context.text?.replace(/^\/spending\s*/, "").trim();
  const days = arg ? parseInt(arg, 10) : 30;

  if (isNaN(days) || days <= 0) {
    await context.send("Usage: /spending [days]\nExample: /spending 30");
    return;
  }

  try {
    const summary = await getExpenseSummary(days);
    if (summary.total === 0 && summary.recent.length === 0) {
      await context.send(`No expenses recorded in the last ${days} days.`);
      return;
    }
    await context.send(formatExpenseSummary(summary, days));
  } catch (err) {
    await context.send(
      `Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function handleExpense(context: MessageContext): Promise<void> {
  const raw = context.text?.replace(/^\/expense\s*/, "").trim() ?? "";
  const parts = raw.split(/\s+/);
  const amountStr = parts[0];

  if (!amountStr) {
    await context.send(
      "Usage: /expense <amount> [category] [description]\nExample: /expense 45.00 food lunch at taqueria",
    );
    return;
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    await context.send(`Invalid amount: "${amountStr}". Must be a positive number.`);
    return;
  }

  const category = parts[1] ?? undefined;
  const description = parts.length > 2 ? parts.slice(2).join(" ") : undefined;

  try {
    const id = await logExpense({ amount, category, description });
    if (!id) {
      await context.send(
        "Expense tracking is disabled or memory is not configured.",
      );
      return;
    }
    const catPart = category ? ` [${category}]` : "";
    const descPart = description ? ` — ${description}` : "";
    await context.send(`Logged: $${amount.toFixed(2)}${catPart}${descPart}`);
  } catch (err) {
    await context.send(
      `Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function handleWaitingOn(context: MessageContext): Promise<void> {
  const raw = context.text?.replace(/^\/waitingon\s*/, "").trim() ?? "";
  const spaceIdx = raw.indexOf(" ");
  const subcommand = spaceIdx >= 0 ? raw.slice(0, spaceIdx).toLowerCase() : raw.toLowerCase();
  const rest = spaceIdx >= 0 ? raw.slice(spaceIdx + 1).trim() : "";

  if (subcommand === "add") {
    if (!rest) {
      await context.send(
        "Usage: /waitingon add <description>\nExample: /waitingon add Invoice from Acme Corp",
      );
      return;
    }
    try {
      const id = await addCommitment({ description: rest });
      if (!id) {
        await context.send(
          "Commitment tracking is disabled or memory is not configured.",
        );
        return;
      }
      await context.send(`Added: "${rest}"\nID: ${id}`);
    } catch (err) {
      await context.send(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  if (subcommand === "done") {
    if (!rest) {
      await context.send("Usage: /waitingon done <id>");
      return;
    }
    try {
      const ok = await fulfillCommitment(rest);
      await context.send(ok ? `Marked fulfilled: ${rest}` : `Failed to fulfill: ${rest}`);
    } catch (err) {
      await context.send(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  // default: list (also handles explicit "list" subcommand)
  try {
    const commitments = await getPendingCommitments();
    if (commitments.length === 0) {
      await context.send(
        "No pending commitments.\nAdd one: /waitingon add <description>",
      );
      return;
    }
    const lines = commitments.map((c) => {
      const due = c.dueDate ? ` (due ${c.dueDate})` : "";
      const who = c.waitingOn ? ` — waiting on: ${c.waitingOn}` : "";
      const proj = c.project ? ` [${c.project}]` : "";
      return `• ${c.description}${who}${due}${proj}\n  ID: ${c.id}`;
    });
    await context.send(`Pending (${commitments.length}):\n\n${lines.join("\n\n")}`);
  } catch (err) {
    await context.send(
      `Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
