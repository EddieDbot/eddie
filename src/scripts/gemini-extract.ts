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

const GEMINI_EXTRACT_MODEL = process.env.GEMINI_EXTRACT_MODEL ?? "gemini-2.5-flash";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

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

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message: string };
}

async function callGemini(transcript: string): Promise<string> {
  if (!GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not set");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EXTRACT_MODEL}:generateContent?key=${GOOGLE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: EXTRACTION_PROMPT + transcript }] }],
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.1,
        },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as GeminiResponse;

  if (data.error) throw new Error(`Gemini error: ${data.error.message}`);

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");

  return text;
}

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

  const raw = await callGemini(transcript);

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
