/**
 * 3-way HTML generation shootout: Gemini vs Kimi vs Sonnet
 * Usage: bun run src/scripts/test-html-shootout.ts [gemini|kimi|sonnet|all]
 *
 * Runs the same Editorial Magazine brief + source content through each model.
 * Outputs to ~/brain-vault/00 - Inbox/shootout-{model}-{timestamp}.html
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, homedir } from "node:path";
import { homedir as getHomedir } from "node:os";
import { callGemini } from "../llm/gemini.ts";
import { callKimi } from "../llm/kimi.ts";
import { runPrompt } from "../claude/run-prompt.ts";

const HOME = getHomedir();
const SOURCE_FILE = `${HOME}/brain-vault/00 - Inbox/SHUR_GapFinder_AHA-report.html`;
const OUT_DIR = `${HOME}/brain-vault/00 - Inbox`;

const EDITORIAL_BRIEF = `
DESIGN WORLD: Editorial Magazine (#01)
Personality: The analyst who reads the FT every morning. Authority through precision, not volume.
References: Bloomberg Businessweek, Financial Times Weekend, NYT Magazine, The Economist

BRIEF:
- Fonts: Playfair Display (headlines, pull quotes) + Inter or DM Sans (body/UI) — load from Google Fonts
- Colors: off-white #FAF8F5 bg, near-black #1A1A1A text, cobalt #1E3A6E accent, warm #C4A882 secondary
- Layout: newspaper multi-column, pull quotes breaking column flow, running headers with issue/date metadata, section headers with horizontal rules, large decorative ghost numbers (200px+, 5% opacity) as section texture
- Data: editorial tables with hairline borders, column rules, no background fills — data earns its color
- CSS animations: IntersectionObserver fade + translateY(20px), 0.6s, column stagger 0.12s
- GSAP upgrade: word-by-word hero reveal power3.out, ScrollTrigger pinned sections (200px), spring pull quotes back.out(1.4), horizontal 3-panel data scroll, parallax hero at 0.3x

MANDATORY RULES:
- If CSS sets opacity:0 on an element, GSAP must use gsap.to({opacity:1}) NOT gsap.from({opacity:0}) — gsap.from() would animate 0→0 (invisible forever)
- Running header: white-space:nowrap, overflow:hidden, text-overflow:ellipsis, flex-shrink:0, min-width:0
- Ghost text opacity minimum 0.06 (not 0.03 — invisible on most screens)
- No-JS fallback: all content must be readable without JavaScript

OUTPUT REQUIREMENTS:
- Single self-contained HTML file (all CSS and JS inline — no external files except Google Fonts CDN and GSAP CDN)
- Full page, production-ready
- Preserve ALL data, findings, and sections from the source content
- Transform the visual presentation only — never omit content
`.trim();

const TASK = (sourceHtml: string) =>
  `
${EDITORIAL_BRIEF}

SOURCE CONTENT TO TRANSFORM:
The following is an HTML intelligence brief that needs to be redesigned in the Editorial Magazine style above.
Extract all content (headlines, data, findings, recommendations, charts, tables) and present it in the new design.

${sourceHtml}

OUTPUT: A single complete self-contained HTML file in Editorial Magazine style. Output ONLY the HTML — no explanation, no markdown fences.
`.trim();

async function run(model: "gemini" | "kimi" | "sonnet") {
  const source = await readFile(SOURCE_FILE, "utf-8");
  const prompt = TASK(source);
  const ts = Date.now();
  const outFile = `${OUT_DIR}/shootout-${model}-${ts}.html`;

  console.log(
    `\n[${model}] Starting... (${Math.round(prompt.length / 1024)}KB prompt)`,
  );
  const start = Date.now();

  let html: string;
  try {
    if (model === "gemini") {
      html = await callGemini({
        prompt,
        maxOutputTokens: 65536,
        timeoutMs: 180_000,
        source: "html-shootout",
      });
    } else if (model === "kimi") {
      html = await callKimi({
        prompt,
        timeoutMs: 300_000,
        source: "html-shootout",
      });
    } else {
      const result = await runPrompt({
        prompt,
        model: "claude-sonnet-4-6",
        system:
          "You are a premium HTML/CSS builder. Output only valid HTML — no explanation, no markdown.",
        maxWaitMs: 300_000,
      });
      if (!result.ok || !result.text)
        throw new Error("runPrompt returned empty");
      html = result.text;
    }
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${model}] FAILED after ${elapsed}s: ${err}`);
    return { model, success: false, elapsed, outFile: null };
  }

  // Strip markdown fences if model wrapped output
  const cleaned = html
    .replace(/^```html?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  await writeFile(outFile, cleaned, "utf-8");
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const kb = Math.round(cleaned.length / 1024);
  console.log(`[${model}] Done in ${elapsed}s → ${kb}KB → ${outFile}`);
  return { model, success: true, elapsed, outFile, kb };
}

const arg = process.argv[2] ?? "all";
const models: Array<"gemini" | "kimi" | "sonnet"> =
  arg === "all"
    ? ["gemini", "kimi", "sonnet"]
    : [arg as "gemini" | "kimi" | "sonnet"];

console.log(`HTML Shootout: ${models.join(", ")}`);
console.log(`Source: ${SOURCE_FILE}`);

const results = [];
for (const model of models) {
  results.push(await run(model));
}

console.log("\n=== RESULTS ===");
for (const r of results) {
  if (r.success) {
    console.log(`✓ ${r.model}: ${r.elapsed}s, ${r.kb}KB → ${r.outFile}`);
  } else {
    console.log(`✗ ${r.model}: FAILED after ${r.elapsed}s`);
  }
}
