#!/usr/bin/env bun
/**
 * store-fact-cli.ts — CLI wrapper for storeFact()
 * Usage: echo "insight text" | bun run ~/eddie/src/scripts/store-fact-cli.ts --category learning --source book-ingest
 */
import { storeFact } from "../memory/store.ts";

const args = process.argv.slice(2);

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const category = (getFlag("--category") ?? "learning") as
  | "goal"
  | "fact"
  | "preference"
  | "learning"
  | "task"
  | "idea";
const source = getFlag("--source") ?? "cli";

// Read from stdin
const chunks: Uint8Array[] = [];
process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
process.stdin.on("end", async () => {
  const content = Buffer.concat(chunks).toString("utf-8").trim();
  if (!content) {
    console.error("Error: no content on stdin");
    process.exit(1);
  }

  await storeFact(content, category, source);
  console.log(`Stored: [${category}] ${content.slice(0, 80)}...`);
  process.exit(0);
});
