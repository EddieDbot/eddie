#!/usr/bin/env bun
import { filterRoadmap, scoreRoadmapItem } from "../proactive/vision.ts";
import { resolve } from "node:path";
import { homedir } from "node:os";

// Load .env if needed for VISION_ENABLED flag
if (!process.env.VISION_ENABLED) {
  const envFile = Bun.file(`${process.env.HOME}/eddie/.env`);
  if (await envFile.exists()) {
    const raw = await envFile.text();
    for (const line of raw.split("\n")) {
      const [k, ...v] = line.split("=");
      if (k && v.length && !process.env[k]) process.env[k] = v.join("=");
    }
  }
}

const args = process.argv.slice(2);
const topIdx = args.indexOf("--top");
const topN = topIdx !== -1 ? parseInt(args[topIdx + 1] ?? "10", 10) : 10;
const singleIdx = args.indexOf("--item");
const singleItem = singleIdx !== -1 ? args[singleIdx + 1] : null;

process.env.VISION_ENABLED = "true";

if (singleItem) {
  const result = await scoreRoadmapItem(singleItem);
  console.log(`Score: ${result.score}/10`);
  console.log(`Reasons: ${result.reasons.join(", ")}`);
} else {
  // Try to load roadmap from Brain Vault
  const roadmapPath = resolve(
    homedir(),
    "brain-vault/90 - Agent Memory/Plans/consolidated-roadmap-2026-02-24.md",
  );
  let items: string[] = [];
  try {
    const raw = await Bun.file(roadmapPath).text();
    items = raw
      .split("\n")
      .filter((l) => l.match(/^[-*]\s+/) || l.match(/^\d+\.\s+/))
      .map((l) => l.replace(/^[-*\d.]\s+/, "").trim())
      .filter((l) => l.length > 10)
      .slice(0, 30);
  } catch {
    items = [
      "Build provenance tracking system",
      "Add tool usage ticker",
      "Daily consolidation reads",
      "Vision alignment scoring",
      "WhatsApp bridge setup",
    ];
  }

  console.log(
    `Scoring ${items.length} items against vision (top ${topN})...\n`,
  );
  const ranked = await filterRoadmap(items, topN);
  console.log("## Top Roadmap Items by Vision Alignment\n");
  for (const item of ranked) {
    console.log(`${item.score}/10 — ${item.description}`);
    if (item.reasons?.length) console.log(`  → ${item.reasons.join("; ")}`);
  }
}
