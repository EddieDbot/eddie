/**
 * Manual test runner for the video pipeline.
 * Usage:
 *   bun run src/scripts/test-video-pipeline.ts news        # test news gathering
 *   bun run src/scripts/test-video-pipeline.ts script      # test script gen on latest story
 *   bun run src/scripts/test-video-pipeline.ts render      # test Remotion render (sample props)
 *   bun run src/scripts/test-video-pipeline.ts voice       # test ElevenLabs voiceover
 *   bun run src/scripts/test-video-pipeline.ts full        # run full pipeline end-to-end
 *   bun run src/scripts/test-video-pipeline.ts status      # show recent renders
 */

import { gatherAINews, pickTopStory } from "../video/news-gatherer.ts";
import { generateNewsShortScript } from "../video/script-generator.ts";
import { renderVideo } from "../video/renderer.ts";
import { synthesize } from "../voice/tts.ts";
import { runDailyShortPipeline, getPipelineStatus } from "../video/pipeline.ts";
import { mkdir } from "node:fs/promises";

const RENDERS_DIR = "/home/na/eddie/data/renders";

const arg = process.argv[2] ?? "status";

if (arg === "news") {
  console.log("Gathering AI news from RSS feeds...");
  const count = await gatherAINews();
  console.log(`\nGathered ${count} new stories.`);
  const top = await pickTopStory();
  if (top) {
    console.log(`\nTop unused story:`);
    console.log(`  Headline: ${top.headline}`);
    console.log(`  Source:   ${top.source}`);
    console.log(`  URL:      ${top.sourceUrl}`);
  } else {
    console.log("No unused stories available.");
  }
} else if (arg === "script") {
  console.log("Picking top story and generating script...");
  const story = await pickTopStory();
  if (!story) {
    console.error("No stories available. Run: bun run test-video-pipeline.ts news");
    process.exit(1);
  }
  console.log(`\nStory: ${story.headline}`);
  console.log("Generating script (Claude Sonnet)...\n");
  const script = await generateNewsShortScript(story);
  if (!script) {
    console.error("Script generation failed.");
    process.exit(1);
  }
  console.log("=== SCRIPT ===");
  console.log(`Title:    ${script.title}`);
  console.log(`Hook:     ${script.hook}`);
  console.log(`Duration: ${script.totalDurationSec}s`);
  console.log(`\nSections:`);
  for (const [i, s] of script.sections.entries()) {
    console.log(`  [${i + 1}] (${s.durationSec}s) ${s.text}`);
    console.log(`       Visual: ${s.visual}`);
  }
  console.log(`\nCTA: ${script.cta}`);
  console.log(`\nDescription:\n${script.description}`);
  console.log(`\nTags: ${script.tags.join(", ")}`);
} else if (arg === "render") {
  console.log("Testing Remotion render with sample props...");
  await mkdir(RENDERS_DIR, { recursive: true });
  const outputPath = `${RENDERS_DIR}/test-render.mp4`;
  const result = await renderVideo({
    composition: "NewsShort",
    props: {
      hook: "OpenAI just changed everything with their latest model",
      sections: [
        { text: "GPT-5 was announced today, scoring 95% on all major benchmarks.", durationSec: 10, visual: "OpenAI logo with benchmark chart" },
        { text: "It's available to ChatGPT Plus users starting right now.", durationSec: 8, visual: "ChatGPT interface" },
        { text: "Developers get API access next week with a $15 per million token price.", durationSec: 10, visual: "API pricing table" },
      ],
      cta: "Follow for daily AI updates",
      title: "OpenAI Drops GPT-5",
      source: "OpenAI Blog",
    },
    outputPath,
  });
  console.log(`\nRender complete!`);
  console.log(`  Output: ${result.outputPath}`);
  console.log(`  Size:   ${result.fileSizeMb.toFixed(2)} MB`);
  console.log(`  Length: ${result.durationSec}s`);
} else if (arg === "voice") {
  console.log("Testing ElevenLabs voiceover...");
  await mkdir(RENDERS_DIR, { recursive: true });
  const text = "OpenAI just changed everything with their latest model. GPT-5 was announced today, scoring 95% on all major benchmarks. It's available to ChatGPT Plus users starting right now. Follow for daily AI updates.";
  const audio = await synthesize(text);
  const outPath = `${RENDERS_DIR}/test-voice.mp3`;
  await Bun.write(outPath, audio);
  console.log(`\nVoiceover saved to: ${outPath}`);
  console.log(`Size: ${(audio.byteLength / 1024).toFixed(1)} KB`);
} else if (arg === "full") {
  console.log("Running full pipeline...");
  console.log("NOTE: This will attempt to upload to YouTube. Make sure OAuth is authorized.\n");
  const result = await runDailyShortPipeline();
  if (result) {
    console.log(`\nPipeline complete!`);
    console.log(`YouTube URL: ${result.youtubeUrl}`);
  } else {
    console.log("Pipeline returned null — check logs.");
    process.exit(1);
  }
} else if (arg === "status") {
  const rows = await getPipelineStatus();
  if (rows.length === 0) {
    console.log("No renders yet. Run: bun run test-video-pipeline.ts full");
  } else {
    console.log("Recent renders:\n");
    for (const r of rows) {
      const ts = new Date(r.createdAt).toLocaleString("en-US", { timeZone: "America/Chicago" });
      console.log(`[${r.status.padEnd(10)}] ${r.id} — ${r.headline.slice(0, 60)}`);
      console.log(`             ${ts} CST`);
      if (r.youtubeUrl) console.log(`             ${r.youtubeUrl}`);
    }
  }
} else {
  console.log("Unknown command. Usage:");
  console.log("  bun run src/scripts/test-video-pipeline.ts [news|script|render|voice|full|status]");
}
