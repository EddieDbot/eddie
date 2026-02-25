import { config } from "../../config.ts";
import type { MessageContext } from "./shared.ts";

const REMOTE_SESSION = "eddie-remote-control";

export async function handleRemote(context: MessageContext): Promise<void> {
  const alive = await isRemoteSessionAlive();
  if (alive) {
    const url = await extractUrlFromPane();
    if (url) {
      await context.send(`Remote session already running:\n\n${url}`);
    } else {
      await context.send(
        "Remote session running but URL not visible yet. Try again in a few seconds, or /stopremote then /remote.",
      );
    }
    return;
  }

  await context.send("Starting remote session...");

  await spawnRemoteSession();

  const url = await pollForUrl(30_000);
  if (url) {
    await context.send(`Remote session ready — open from any device:\n\n${url}`);
  } else {
    await context.send(
      "Remote session started but couldn't extract URL.\nManually: `tmux attach -t eddie-remote-control`",
    );
  }
}

export async function handleStopRemote(context: MessageContext): Promise<void> {
  const killed = await killRemoteSession();
  await context.send(killed ? "Remote session stopped." : "No remote session was running.");
}

async function spawnRemoteSession(): Promise<void> {
  const proc = Bun.spawn([
    config.TMUX_PATH,
    "new-session",
    "-d",
    "-s",
    REMOTE_SESSION,
    `${config.CLAUDE_PATH} remote-control`,
  ]);
  await proc.exited;
}

async function isRemoteSessionAlive(): Promise<boolean> {
  const proc = Bun.spawn([config.TMUX_PATH, "has-session", "-t", REMOTE_SESSION], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
  return proc.exitCode === 0;
}

async function killRemoteSession(): Promise<boolean> {
  if (!(await isRemoteSessionAlive())) return false;
  const proc = Bun.spawn([config.TMUX_PATH, "kill-session", "-t", REMOTE_SESSION], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
  return true;
}

async function capturePane(): Promise<string> {
  const proc = Bun.spawn(
    [config.TMUX_PATH, "capture-pane", "-p", "-t", REMOTE_SESSION, "-S", "-200"],
    { stdout: "pipe", stderr: "ignore" },
  );
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return output;
}

async function extractUrlFromPane(): Promise<string | null> {
  const output = await capturePane();
  const match = output.match(/https:\/\/claude\.ai\/code\S+/);
  return match?.[0]?.replace(/[.,;)]+$/, "") ?? null;
}

async function pollForUrl(maxMs: number): Promise<string | null> {
  const interval = 2_000;
  let elapsed = 0;
  while (elapsed < maxMs) {
    const url = await extractUrlFromPane();
    if (url) return url;
    await new Promise((r) => setTimeout(r, interval));
    elapsed += interval;
  }
  return null;
}
