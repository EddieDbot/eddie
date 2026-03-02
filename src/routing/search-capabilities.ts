#!/usr/bin/env bun
// CLI: bun ~/eddie/src/routing/search-capabilities.ts "<query>"

import { routeCapabilities } from "./router.ts";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error("Usage: bun search-capabilities.ts <natural language query>");
  process.exit(1);
}

const result = routeCapabilities(query);

const lines: string[] = [`Query: "${query}"`, `Confidence: ${result.confidence ?? 0}%`, ""];

if (result.agents.length > 0) {
  lines.push("Agents:");
  for (const a of result.agents) lines.push(`  agent:${a}`);
  lines.push("");
}

if (result.mcps.length > 0) {
  lines.push("MCPs:");
  for (const m of result.mcps) lines.push(`  mcp:${m}`);
  lines.push("");
}

if (result.commands && result.commands.length > 0) {
  lines.push("Commands:");
  for (const c of result.commands) lines.push(`  /${c}`);
  lines.push("");
}

if (result.contextHints.length > 0) {
  lines.push("Hints:");
  for (const h of result.contextHints) lines.push(`  ${h}`);
}

if (result.agents.length === 0 && result.mcps.length === 0 && (!result.commands || result.commands.length === 0)) {
  lines.push("No matches found.");
}

console.log(lines.join("\n"));
