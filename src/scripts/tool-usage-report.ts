#!/usr/bin/env bun
import { formatToolUsageSummary } from "../memory/tool-ticker.ts";

const args = process.argv.slice(2);
const daysIdx = args.indexOf("--days");
const days = daysIdx !== -1 ? parseInt(args[daysIdx + 1] ?? "7", 10) : 7;

// Load .env if needed
if (!process.env.SUPABASE_URL) {
  const envFile = Bun.file(`${process.env.HOME}/eddie/.env`);
  if (await envFile.exists()) {
    const raw = await envFile.text();
    for (const line of raw.split("\n")) {
      const [k, ...v] = line.split("=");
      if (k && v.length && !process.env[k]) process.env[k] = v.join("=");
    }
  }
}

process.env.TOOL_TICKER_ENABLED = "true";
const report = await formatToolUsageSummary(days);
console.log(`## Tool Usage Report (last ${days} days)\n\n${report}`);
