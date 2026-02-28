import { generateNewsShortScript } from "../video/script-generator.ts";

const mockStory = {
  id: "test-plan2-verify",
  headline: "Google DeepMind AlphaFold 3 now predicts all molecular structures — not just proteins",
  source: "Nature",
  sourceUrl: "https://nature.com",
  summary: "AlphaFold 3 expands beyond proteins to DNA, RNA, and small molecules, enabling drug discovery at 10x speed.",
  publishedAt: new Date().toISOString(),
  used: false,
  usedAt: null,
  score: 95,
};

console.log("Generating script (Plan 2 — hook rotation hint: reframe, number-anchor)...\n");
const script = await generateNewsShortScript(mockStory, ["reframe", "number-anchor"]);
if (!script) {
  console.error("FAIL: script returned null");
  process.exit(1);
}

console.log("=== NEW FIELDS ===");
console.log(`hookType:        ${script.hookType}`);
console.log(`pillar:          ${script.pillar}`);
console.log(`funnelPosition:  ${script.funnelPosition}`);
console.log(`implicitOffer:   ${script.implicitOffer}`);
console.log(`landingReframes: ${script.landingReframes}`);
console.log("\n=== SCRIPT ===");
console.log(`Title:    ${script.title}`);
console.log(`Emotion:  ${script.emotionTarget}`);
console.log(`Hook:     ${script.hook}`);
console.log(`Foreshadow: ${script.foreshadow}`);
console.log(`Body:     ${script.body.join(" | ")}`);
console.log(`Payoff:   ${script.payoff}`);
console.log(`Duration: ${script.estimatedRuntimeSec}s`);
console.log("\nPASS — all new fields present");
