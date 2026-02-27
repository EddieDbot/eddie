import type { MessageContext } from "./shared.ts";

import { config } from "../../config.ts";
const CODE_SERVER_URL = config.TAILSCALE_HOST
  ? `http://${config.TAILSCALE_HOST}:8888`
  : "http://localhost:8888";

export async function handleView(context: MessageContext): Promise<void> {
  const alive = await isCodeServerAlive();
  if (!alive) {
    await context.send("Starting code-server...");
    await startCodeServer();
    await new Promise((r) => setTimeout(r, 2000));
  }
  await context.send(
    `code-server ready — open from any device:\n\n${CODE_SERVER_URL}`,
  );
}

async function isCodeServerAlive(): Promise<boolean> {
  const proc = Bun.spawn(["systemctl", "--user", "is-active", "code-server"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  await proc.exited;
  const out = await new Response(proc.stdout).text();
  return out.trim() === "active";
}

async function startCodeServer(): Promise<void> {
  const proc = Bun.spawn(["systemctl", "--user", "start", "code-server"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
}
