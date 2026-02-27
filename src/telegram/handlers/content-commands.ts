import type { MessageContext } from "./shared.ts";
import { checkClaude } from "../../claude/health.ts";
import { resetSession } from "../../claude/session.ts";
import { config } from "../../config.ts";
import { initiateCall } from "../../voice/call.ts";
import {
  startBrainstorm,
  endBrainstorm,
  isInBrainstorm,
} from "../../proactive/brainstorm.ts";
import { listAgents } from "../../agents/registry.ts";
import {
  addRevenueEntry,
  getRevenueSummary,
  formatRevenueSummary,
} from "../../proactive/revenue.ts";
import { createJob } from "../../jobs/manager.ts";
import { spawnJob } from "../../jobs/tmux.ts";

export async function handleStart(context: MessageContext): Promise<void> {
  await context.send(
    "EDDIE online. Send me a message and I'll relay it to Claude.",
  );
}

export async function handleStatus(context: MessageContext): Promise<void> {
  const health = await checkClaude();

  if (health.ok) {
    const msg = health.version
      ? `Claude is healthy. Model: ${health.version}`
      : "Claude is healthy.";
    await context.send(msg);
  } else {
    await context.send(`Claude health check failed: ${health.error}`);
  }
}

export async function handleNewSession(context: MessageContext): Promise<void> {
  const chatId = context.chat.id;
  const sessionId = await resetSession(chatId);
  await context.send(`Session reset. New session: ${sessionId.slice(0, 8)}...`);
}

export async function handleBrainstorm(context: MessageContext): Promise<void> {
  const chatId = context.chat.id;
  let text = context.text?.replace(/^\/brainstorm\s*/, "").trim();

  if (!text && isInBrainstorm(chatId)) {
    endBrainstorm(chatId);
    await context.send("Brainstorm ended.");
    return;
  }

  if (!text) {
    await context.send(
      "Usage: /brainstorm [--level 1-4] [--batch] <topic>\nWhile active, send /brainstorm to end.\n--batch: Generate 10 ideas and save to Brain Vault.",
    );
    return;
  }

  // Parse --batch flag
  const isBatch = /--batch\s*/.test(text);
  if (isBatch) {
    text = text.replace(/--batch\s*/, "").trim();
  }

  // Parse --level N flag
  let level: import("../../proactive/brainstorm.ts").BrainstormLevel = 2;
  const levelMatch = text.match(/--level\s+([1-4])\s*/);
  if (levelMatch) {
    level = parseInt(levelMatch[1]!) as typeof level;
    text = text.replace(levelMatch[0], "").trim();
  }

  if (isBatch) {
    if (!text) {
      await context.send("Usage: /brainstorm --batch <topic>");
      return;
    }
    await context.send(`Brainstorm batch started for "${text}"...`);
    const { runPromptMulti: runPrompt } =
      await import("../../llm/run-prompt-multi.ts");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { BRAIN_VAULT_ROOT } =
      await import("../../memory/brain-vault-paths.ts");
    const date = new Date().toISOString().slice(0, 10);
    const slug = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40);
    const prompt = `Generate 10 creative, actionable ideas on the topic: "${text}"\n\nFor each idea, provide:\n- A punchy title\n- 2-3 sentence description\n- Why it matters\n\nBe specific and avoid generic advice. Think like a creative technologist.`;
    const { text: result, ok } = await runPrompt({
      system: `You are a creative strategist brainstorming for Nicholas, a creative technologist. Level ${level}: ${
        (level as number) === 1
          ? "practical, immediately actionable"
          : (level as number) === 3
            ? "challenge assumptions, 2nd/3rd order effects"
            : (level as number) === 4
              ? "contrarian deep-dive, question the premise"
              : "mix practical and creative"
      }.`,
      prompt,
      maxWaitMs: 30_000,
      source: "brainstorm",
    });
    if (!ok) {
      await context.send("Brainstorm batch failed.");
      return;
    }
    const dir = `${BRAIN_VAULT_ROOT}/00 - Inbox`;
    await mkdir(dir, { recursive: true });
    const filePath = `${dir}/brainstorm-${slug}-${date}.md`;
    await writeFile(
      filePath,
      `---\ntopic: ${text}\ndate: ${date}\nlevel: ${level}\n---\n\n# Brainstorm: ${text}\n\n${result}\n`,
    );
    await context.send(
      `Brainstorm batch complete. 10 ideas saved to:\n${filePath}`,
    );
    return;
  }

  startBrainstorm(chatId, text, level);
  await context.send(
    `Brainstorm started: "${text}" (level ${level})\nSend /brainstorm to end.`,
  );
}

export async function handleCall(context: MessageContext): Promise<void> {
  const sid = config.TWILIO_ACCOUNT_SID;
  const phone = config.OWNER_PHONE;
  const webhookPort = config.TWILIO_WEBHOOK_PORT;

  if (!sid || !phone) {
    await context.send(
      "Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, and OWNER_PHONE.",
    );
    return;
  }

  const webhookUrl = config.TWILIO_WEBHOOK_URL;
  const webhookBaseUrl = webhookUrl || `https://localhost:${webhookPort}`;
  try {
    const result = await initiateCall(phone, webhookBaseUrl);
    await context.send(
      `Call initiated. SID: ${result.sid}, Status: ${result.status}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await context.send(`Call failed: ${msg}`);
  }
}

export async function handleAgents(context: MessageContext): Promise<void> {
  const agents = await listAgents();
  if (agents.length === 0) {
    await context.send("No agents found in ~/.claude/agents/");
    return;
  }
  const lines = agents.map(
    (a) =>
      `• ${a.slug} [${a.model}] — ${a.description.slice(0, 80) || "(no description)"}`,
  );
  const chunks: string[] = [];
  let current = `Agents (${agents.length}):\n`;
  for (const line of lines) {
    if (current.length + line.length + 1 > 4000) {
      chunks.push(current);
      current = "";
    }
    current += line + "\n";
  }
  if (current) chunks.push(current);
  for (const chunk of chunks) {
    await context.send(chunk);
  }
}

export async function handleYoutube(context: MessageContext): Promise<void> {
  const channelId = config.YOUTUBE_CHANNEL_ID;
  if (!channelId) {
    await context.send(
      "YOUTUBE_CHANNEL_ID not set. Add it to .env to enable this command.",
    );
    return;
  }
  await context.send("Fetching YouTube stats...");
  const { getChannelStats, getRecentVideos } =
    await import("../../comms/youtube.ts");
  const [stats, videos] = await Promise.all([
    getChannelStats(channelId),
    getRecentVideos(channelId, 5),
  ]);

  const lines: string[] = ["YouTube Channel\n"];
  if (stats) {
    lines.push(`${stats.title}`);
    lines.push(`${Number(stats.subscriberCount).toLocaleString()} subscribers`);
    lines.push(`${Number(stats.viewCount).toLocaleString()} total views`);
    lines.push(`${stats.videoCount} videos\n`);
  }
  if (videos.length > 0) {
    lines.push("Recent Videos:");
    for (const v of videos) {
      const date = new Date(v.publishedAt).toLocaleDateString();
      lines.push(
        `• ${v.title} (${Number(v.viewCount).toLocaleString()} views) — ${date}`,
      );
    }
  }
  await context.send(lines.join("\n"));
}

export async function handleAutomate(context: MessageContext): Promise<void> {
  const task = context.text?.replace(/^\/automate\s*/, "").trim();
  if (!task) {
    await context.send(
      "Usage: /automate <browser task description>\n\nExample: /automate Take screenshot of https://example.com",
    );
    return;
  }
  await context.send(`Starting browser automation...\n\nTask: ${task}`);
  const prompt = `Use the Playwright MCP tools to: ${task}\n\nCapture screenshots at each step. Report what you find.`;
  const job = await createJob("claude", prompt);
  await spawnJob(job);
  await context.send(
    `Browser job #${job.id} started. Session: ${job.tmuxSession}`,
  );
}

export async function handleRevenue(context: MessageContext): Promise<void> {
  const args = context.text?.split(" ").slice(1) ?? [];
  const subcommand = args[0];

  try {
    if (subcommand === "add") {
      const amount = parseFloat(args[1] ?? "");
      const source = args[2];
      const description = args.slice(3).join(" ") || undefined;

      if (isNaN(amount) || !source) {
        await context.send(
          "Usage: /revenue add <amount> <source> [description]\nExample: /revenue add 500 freelance Website project",
        );
        return;
      }
      await addRevenueEntry(amount, source, description);
      await context.send(`Revenue logged: $${amount} from ${source}`);
    } else {
      const summary = await getRevenueSummary();
      await context.send(formatRevenueSummary(summary), {
        parse_mode: "Markdown",
      });
    }
  } catch (e) {
    await context.send(`Error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function handleBook(context: MessageContext): Promise<void> {
  const text = context.text?.replace(/^\/book\s*/, "").trim() ?? "";
  const parts = text.split(/\s+/);
  const sub = parts[0]?.toLowerCase();

  if (!sub || sub === "help") {
    await context.send(
      "/book commands:\n" +
        '  /book find "Title" "Author" — search + download + ingest\n' +
        "  /book ingest <path> — ingest a local file\n" +
        "  /book inbox — list unprocessed books in inbox\n",
    );
    return;
  }

  if (sub === "inbox") {
    const { readdir } = await import("node:fs/promises");
    const { homedir } = await import("node:os");
    const rawDir = `${homedir()}/brain-vault/00 - Inbox/books/_raw`;
    try {
      const files = await readdir(rawDir);
      const books = files.filter((f) => /\.(pdf|epub|txt)$/i.test(f));
      if (books.length === 0) {
        await context.send("No books in inbox.");
      } else {
        await context.send(
          `Books in inbox (${books.length}):\n` +
            books.map((f) => `  • ${f}`).join("\n"),
        );
      }
    } catch {
      await context.send("Inbox not found or empty.");
    }
    return;
  }

  if (sub === "ingest") {
    const bookPath = parts
      .slice(1)
      .join(" ")
      .replace(/^["']|["']$/g, "");
    if (!bookPath) {
      await context.send("Usage: /book ingest <path>");
      return;
    }
    const { ingestBook } = await import("../../proactive/book-ingest.ts");
    try {
      const { jobId, session } = await ingestBook(bookPath);
      await context.send(
        `Book ingestion started.\nJob: ${jobId.slice(0, 8)}\nSession: ${session}`,
      );
    } catch (err) {
      await context.send(`Error: ${String(err)}`);
    }
    return;
  }

  if (sub === "find") {
    const remaining = parts.slice(1).join(" ");
    const quoted = [...remaining.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    let title: string;
    let author: string | undefined;
    if (quoted.length >= 1) {
      title = quoted[0]!;
      author = quoted[1];
    } else {
      title = parts[1] ?? "";
      author = parts.slice(2).join(" ") || undefined;
    }
    if (!title) {
      await context.send('Usage: /book find "Title" "Author"');
      return;
    }
    await context.send(
      `Searching for: ${title}${author ? ` by ${author}` : ""}...`,
    );
    const { findBook, ingestBook } =
      await import("../../proactive/book-ingest.ts");
    try {
      const result = await findBook(title, author);
      if (result.found && result.download_path) {
        await context.send(
          `Found! Source: ${result.source}\nFormat: ${result.format}\nStarting ingestion...`,
        );
        const { jobId, session } = await ingestBook(result.download_path, {
          title,
        });
        await context.send(
          `Ingestion started.\nJob: ${jobId.slice(0, 8)}\nSession: ${session}`,
        );
      } else if (result.alternatives.length > 0) {
        const alts = result.alternatives
          .map(
            (a) =>
              `  • ${String(a["source"])}: ${String(a["title"])} — ${String(a["note"] ?? "")}`,
          )
          .join("\n");
        await context.send(
          `Not found for direct download.\nAlternatives:\n${alts}`,
        );
      } else {
        await context.send(`Book not found: "${title}"`);
      }
    } catch (err) {
      await context.send(`Error: ${String(err)}`);
    }
    return;
  }

  await context.send(
    'Unknown subcommand. Try: /book help\nUsage: /book find "Title" "Author"',
  );
}

export async function handleGptCustom(context: MessageContext): Promise<void> {
  const text = context.text?.replace(/^\/gptcustom\s*/, "").trim() ?? "";
  if (!text) {
    await context.send(
      "Usage: /gptcustom Name | Instructions\nExample: /gptcustom Sales Coach | You are an expert sales coach...",
    );
    return;
  }

  const pipeIdx = text.indexOf("|");
  if (pipeIdx === -1) {
    await context.send(
      "Use | to separate name from instructions.\nExample: /gptcustom Sales Coach | You are...",
    );
    return;
  }

  const name = text.slice(0, pipeIdx).trim();
  const instructions = text.slice(pipeIdx + 1).trim();
  if (!name || !instructions) {
    await context.send("Both name and instructions are required.");
    return;
  }

  await context.send(`Creating GPT "${name}"...`);
  try {
    const proc = Bun.spawn(
      [
        "bun",
        "run",
        `${process.env.HOME}/eddie/src/scripts/create-gpt.ts`,
        "--name",
        name,
        "--instructions",
        instructions,
      ],
      { cwd: `${process.env.HOME}/eddie`, stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const urlMatch = output.match(/https:\/\/chatgpt\.com\/g\/g-[^\s]+/);
    if (urlMatch) {
      await context.send(`Done.\n${urlMatch[0]}`);
    } else {
      await context.send(`GPT saved. Check https://chatgpt.com/gpts/mine`);
    }
  } catch (err) {
    await context.send(
      `Failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
