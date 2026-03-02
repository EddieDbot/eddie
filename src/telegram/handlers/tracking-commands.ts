import type { MessageContext } from "./shared.ts";
import {
  addCommitment,
  fulfillCommitment,
  getPendingCommitments,
} from "../../proactive/waiting-on-tracker.ts";

export async function handleSpending(context: MessageContext): Promise<void> {
  await context.send("Expense tracking is not available in this build.");
}

export async function handleExpense(context: MessageContext): Promise<void> {
  await context.send("Expense tracking is not available in this build.");
}

export async function handleWaitingOn(context: MessageContext): Promise<void> {
  const raw = context.text?.replace(/^\/waitingon\s*/, "").trim() ?? "";
  const spaceIdx = raw.indexOf(" ");
  const subcommand =
    spaceIdx >= 0 ? raw.slice(0, spaceIdx).toLowerCase() : raw.toLowerCase();
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
      await context.send(
        ok ? `Marked fulfilled: ${rest}` : `Failed to fulfill: ${rest}`,
      );
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
    await context.send(
      `Pending (${commitments.length}):\n\n${lines.join("\n\n")}`,
    );
  } catch (err) {
    await context.send(
      `Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
