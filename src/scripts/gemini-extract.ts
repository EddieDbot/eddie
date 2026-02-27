/**
 * Gemini extraction pre-pass for transcripts and large documents.
 *
 * Usage: bun run src/scripts/gemini-extract.ts <inputPath>
 *
 * Reads the file at inputPath, runs the extraction schema through Gemini,
 * writes JSON to <inputPath>-gemini.json, prints the output path to stdout.
 *
 * Design: Gemini reads the full raw transcript (1M context) and outputs
 * structured extraction JSON (~2-4k tokens). Sonnet then validates/enhances
 * the JSON — never needing to read the raw transcript itself.
 */

import { callGemini } from "../llm/gemini.ts";

const EXTRACTION_PROMPT = `You are a transcript extraction engine. Your job is to extract structured insights from the transcript below according to a precise schema.

Output ONLY valid JSON matching this schema exactly — no markdown, no explanation, no code fences:

{
  "key_themes": [
    { "theme": "...", "description": "..." }
  ],
  "techniques_and_frameworks": [
    { "name": "...", "description": "...", "application": "..." }
  ],
  "contrarian_beliefs": [
    "..."
  ],
  "notable_quotes": [
    { "quote": "...", "context": "..." }
  ],
  "anti_patterns": [
    "..."
  ],
  "elite_vs_competent": [
    "..."
  ],
  "actionable_insights": [
    "..."
  ],
  "summary": "..."
}

Rules:
- key_themes: major recurring topics with context. 3-8 entries.
- techniques_and_frameworks: named methods, processes, models described. Include all.
- contrarian_beliefs: opinions that challenge conventional wisdom. Include subtle ones — do NOT miss these.
- notable_quotes: direct quotes capturing key ideas. Include timestamps if present in the transcript.
- anti_patterns: common mistakes, failure modes, things to avoid. Include all.
- elite_vs_competent: specific differentiators between mastery and average competence. Include all.
- actionable_insights: specific, concrete things a person could DO. Must be practical.
- summary: 3-4 sentence overview of the content.

Extract EVERYTHING. Do not summarize prematurely. The validation agent will prune — your job is to miss nothing.

TRANSCRIPT:
`;

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: bun run gemini-extract.ts <inputPath>");
    process.exit(1);
  }

  const transcript = await Bun.file(inputPath).text();
  if (!transcript.trim()) {
    console.error("Input file is empty");
    process.exit(1);
  }

  const raw = await callGemini({ prompt: EXTRACTION_PROMPT + transcript, source: "gemini-extract" });

  // Strip markdown code fences if Gemini wrapped the JSON
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  // Validate it's parseable JSON
  JSON.parse(cleaned);

  const outputPath = inputPath.replace(/(\.[^.]+)?$/, "-gemini.json");
  await Bun.write(outputPath, cleaned);
  console.log(outputPath);
}

main().catch((err) => {
  console.error("gemini-extract failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
