import type { Bot } from "gramio";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { createJob } from "../jobs/manager.ts";
import { spawnJob } from "../jobs/tmux.ts";
import { logProvenance } from "../memory/provenance.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

const HOME = homedir();
const BRAIN_VAULT = `${HOME}/brain-vault`;
const BOOKS_INBOX = `${BRAIN_VAULT}/00 - Inbox/books`;
const RAW_DIR = `${BOOKS_INBOX}/_raw`;
const PROCESSED_DIR = `${BOOKS_INBOX}/_processed`;
const PROCESSED_LOG = `${BOOKS_INBOX}/processed-books.txt`;
const REPORTS_DIR = `${BRAIN_VAULT}/90 - Agent Memory/Plans`;
const BOOK_PARSER = `${HOME}/.claude/scripts/book-parser.py`;
const BOOK_FINDER = `${HOME}/.claude/scripts/book-finder.py`;

export type FindBookResult = {
  found: boolean;
  source: string | null;
  download_path: string | null;
  format: string | null;
  metadata: Record<string, unknown>;
  alternatives: Array<Record<string, unknown>>;
};

async function loadProcessed(): Promise<Set<string>> {
  try {
    const text = await readFile(PROCESSED_LOG, "utf-8");
    const hashes = new Set<string>();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      hashes.add(trimmed.split("|")[0]!.trim());
    }
    return hashes;
  } catch {
    return new Set();
  }
}

async function markProcessed(hash: string, title: string): Promise<void> {
  const entry = `${hash}|${title}|${new Date().toISOString()}\n`;
  const existing = await readFile(PROCESSED_LOG, "utf-8").catch(() => "");
  await writeFile(PROCESSED_LOG, existing + entry);
}

async function hashFile(filePath: string): Promise<string> {
  const { createReadStream } = await import("node:fs");
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex").slice(0, 16)));
    stream.on("error", reject);
  });
}

export async function findBook(
  title: string,
  author?: string,
): Promise<FindBookResult> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const args = [BOOK_FINDER, title, ...(author ? [author] : [])];
    const proc = spawn("python3", args, {
      env: { ...process.env, GOOGLE_API_KEY: config.GOOGLE_API_KEY ?? "" },
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", () => {
      if (stderr)
        logger.debug("book-finder:stderr", { stderr: stderr.slice(0, 500) });
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve({
          found: false,
          source: null,
          download_path: null,
          format: null,
          metadata: {},
          alternatives: [],
        });
      }
    });
  });
}

async function scanBookInbox(): Promise<Array<{ path: string; hash: string }>> {
  try {
    await mkdir(RAW_DIR, { recursive: true });
    const files = await readdir(RAW_DIR);
    const processed = await loadProcessed();
    const books: Array<{ path: string; hash: string }> = [];

    for (const file of files) {
      if (!/\.(pdf|epub|txt)$/i.test(file)) continue;
      const fullPath = `${RAW_DIR}/${file}`;
      const hash = await hashFile(fullPath).catch(() => "");
      if (!hash || processed.has(hash)) continue;
      books.push({ path: fullPath, hash });
    }
    return books;
  } catch {
    return [];
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function buildBookJobPrompt(
  bookPath: string,
  title: string,
  opts?: { hash?: string },
): string {
  const date = new Date().toISOString().split("T")[0]!;
  const slug = slugify(title);
  const reportPath = `${REPORTS_DIR}/book-${date}-${slug}.md`;

  return `## Book Ingestion: ${title}

**Book path:** ${bookPath}
**Hash:** ${opts?.hash ?? "unknown"}
**Report path:** ${reportPath}
**Date:** ${date}

Run the /ingest-book command pipeline for this book:
- Source file: ${bookPath}
- Parser script: ${BOOK_PARSER}
- Finder script: ${BOOK_FINDER}
- Output report: ${reportPath}

Follow all 7 steps from the /ingest-book command:
1. Verify file exists at ${bookPath}
2. Parse with book-parser.py → get manifest
3. Extract chunks in parallel (chapters sequential, chunks parallel, up to 4)
4. Book reduce → master report
5. Route to Brain Vault projects
6. Move book to _processed/, mark in processed-books.txt
7. Push top 5 insights + frameworks to vector memory via store-fact-cli.ts

End your response with:
BOOK_REPORT: ${title} | chapters=N | chunks=N | claims=N | frameworks=N | insights=N | routed=<project or Plans> | ${reportPath}
`;
}

export async function ingestBook(
  bookPath: string,
  opts?: { title?: string; hash?: string },
): Promise<{ jobId: string; session: string }> {
  const title =
    opts?.title ??
    bookPath
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "") ??
    "Unknown";
  const prompt = buildBookJobPrompt(bookPath, title, opts);
  const job = await createJob("claude", prompt);
  await spawnJob(job);
  logger.info("book-ingest:spawned", { bookPath, title, jobId: job.id });
  logProvenance({
    feature_name: title,
    source_type: "book",
    source_ref: opts?.hash,
    source_title: title,
    job_id: job.id,
    status: "in_progress",
  }).catch(() => {});
  return { jobId: job.id, session: job.tmuxSession };
}

let _activeBookJob = false;

export async function checkBookInbox(): Promise<{ spawned: number }> {
  if (_activeBookJob) {
    logger.debug("book-ingest:skipping — book job already active");
    return { spawned: 0 };
  }

  const books = await scanBookInbox();
  if (books.length === 0) return { spawned: 0 };

  // Process one book at a time
  const book = books[0]!;
  _activeBookJob = true;

  try {
    const title =
      book.path
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? "Unknown";
    await ingestBook(book.path, { title, hash: book.hash });
    await markProcessed(book.hash, title);
    return { spawned: 1 };
  } finally {
    // Release lock after 10 min (book jobs are long)
    setTimeout(() => {
      _activeBookJob = false;
    }, 600_000);
  }
}

export function startBookWatcher(bot: Bot): void {
  logger.info("book-ingest:watcher-started", {
    interval: config.BOOK_INBOX_POLL_INTERVAL_MS,
    inboxDir: RAW_DIR,
  });

  setInterval(() => {
    checkBookInbox().catch((err) => {
      logger.error("book-ingest:check-error", { error: String(err) });
    });
  }, config.BOOK_INBOX_POLL_INTERVAL_MS);
}
