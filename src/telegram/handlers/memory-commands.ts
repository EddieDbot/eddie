import type { MessageContext } from "./shared.ts";
import { storeFact } from "../../memory/store.ts";
import { searchMemory } from "../../memory/search.ts";
import { getSupabase, memoryEnabled } from "../../memory/client.ts";
import { logProjectActivity } from "../../memory/activity.ts";

export async function handleRemember(context: MessageContext): Promise<void> {
  if (!memoryEnabled) {
    await context.send("Memory not configured.");
    return;
  }
  const text = context.text?.replace(/^\/remember\s*/, "").trim();
  if (!text) {
    await context.send("Usage: /remember <something to remember>");
    return;
  }
  await storeFact(text, "fact", "telegram");
  await context.send("Remembered.");
}

export async function handleForget(context: MessageContext): Promise<void> {
  if (!memoryEnabled) {
    await context.send("Memory not configured.");
    return;
  }
  const text = context.text?.replace(/^\/forget\s*/, "").trim();
  if (!text) {
    await context.send("Usage: /forget <something to forget>");
    return;
  }
  const results = await searchMemory(text, 5, 0.5);
  const factIds = results.filter((r) => r.source === "facts").map((r) => r.id);
  if (factIds.length === 0) {
    await context.send("No matching memories found.");
    return;
  }
  const { error } = await getSupabase()
    .from("facts")
    .update({ active: false, updated_at: new Date().toISOString() })
    .in("id", factIds);
  if (error) {
    await context.send(`Error: ${error.message}`);
    return;
  }
  await context.send(
    `Forgot ${factIds.length} matching memory${factIds.length > 1 ? "ies" : ""}.`,
  );
}

export async function handleGoals(context: MessageContext): Promise<void> {
  const args = context.text?.split(" ").slice(1) ?? [];
  const subcommand = args[0];

  try {
    const { listGoals, addGoal, completeGoal, formatGoalsMessage } =
      await import("../../proactive/goals.ts");

    if (subcommand === "add") {
      const title = args.slice(1).join(" ");
      if (!title) {
        await context.send("Usage: /goals add <goal title>");
        return;
      }
      await addGoal(title);
      await context.send(`Goal added: "${title}"`);
    } else if (subcommand === "done") {
      const id = args[1];
      if (!id) {
        await context.send("Usage: /goals done <goal-id>");
        return;
      }
      await completeGoal(id);
      await context.send("Goal marked complete.");
    } else {
      const goals = await listGoals("active");
      const msg = formatGoalsMessage(goals);
      await context.send(`Active Goals\n\n${msg}`);
    }
  } catch (e) {
    await context.send(`Error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function handleMilestone(context: MessageContext): Promise<void> {
  const text = context.text?.replace(/^\/milestone\s*/, "").trim();
  if (!text) {
    await context.send(
      "Usage: /milestone <name> [— description]\n\nExamples:\n/milestone Revenue $5K\n/milestone First Client — signed and paid",
    );
    return;
  }

  const dashIdx = text.indexOf(" — ");
  const name = dashIdx >= 0 ? text.slice(0, dashIdx).trim() : text;
  const description = dashIdx >= 0 ? text.slice(dashIdx + 3).trim() : undefined;

  await context.send("Logging milestone...");

  const { markMilestoneReached } = await import("../../proactive/goals.ts");
  const result = await markMilestoneReached(name, description);

  if (result.alreadyReached) {
    await context.send(`Already logged: ${result.message}`);
    return;
  }

  await context.send(`Milestone reached: ${name}\n\n${result.message}`);
}

export async function handleCollabLog(context: MessageContext): Promise<void> {
  const args = context.text?.replace(/^\/collab[_-]log\s*/, "").trim() ?? "";
  const spaceIdx = args.indexOf(" ");
  if (!args || spaceIdx === -1) {
    await context.send(
      "Usage: /collab-log <project-slug> <summary>\nExample: /collab-log crabill-leadgen Reviewed landing page copy and updated CTA",
    );
    return;
  }
  const slug = args.slice(0, spaceIdx).trim();
  const summary = args.slice(spaceIdx + 1).trim();
  try {
    await logProjectActivity(slug, summary, "COLLAB");
    await context.send(`Logged to ${slug}: [COLLAB] ${summary}`);
  } catch (err) {
    await context.send(
      `Failed to log: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
