import type { MessageContext } from "./shared.ts";

export async function handleDashboard(context: MessageContext): Promise<void> {
  await context.send("Generating dashboard...");
  try {
    const { generateDashboard } = await import("../../proactive/dashboard-gen.ts");
    const dashboard = await generateDashboard();
    await context.send(dashboard.slice(0, 4000));
  } catch (err) {
    await context.send(`Dashboard failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
