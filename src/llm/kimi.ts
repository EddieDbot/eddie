import { spawn } from "node:child_process";
import { config } from "../config.ts";

export type CallKimiOpts = {
  prompt: string;
  system?: string;
  timeoutMs?: number;
  source?: string;
};

export async function callKimi(opts: CallKimiOpts): Promise<string> {
  const kimiPath = config.KIMI_PATH ?? "kimi";
  const timeoutMs = opts.timeoutMs ?? 300_000;

  const fullPrompt = opts.system
    ? `${opts.system}\n\n${opts.prompt}`
    : opts.prompt;

  return new Promise((resolve, reject) => {
    const child = spawn(kimiPath, ["--quiet"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${process.env.PATH ?? ""}:/home/na/.local/bin`,
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Kimi timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Kimi exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      const text = stdout.trim();
      if (!text) reject(new Error("Kimi returned no output"));
      else resolve(text);
    });

    child.stdin.write(fullPrompt);
    child.stdin.end();
  });
}
