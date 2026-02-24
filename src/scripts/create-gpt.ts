#!/usr/bin/env bun
/**
 * create-gpt.ts — Automate Custom GPT creation via Playwright
 *
 * Usage (manual instructions):
 *   bun run src/scripts/create-gpt.ts --name "Name" --instructions "You are..."
 *   bun run src/scripts/create-gpt.ts --name "Name" --instructions-file ./prompt.txt [--file ./knowledge.pdf]
 *
 * Usage (content-type templates — auto-generates expert instructions):
 *   bun run src/scripts/create-gpt.ts --name "Name" --content-type book --topic "Sun Tzu's Art of War"
 *   bun run src/scripts/create-gpt.ts --name "Name" --content-type transcript --topic "Huberman Lab: Sleep" --file ./transcript.txt
 *   bun run src/scripts/create-gpt.ts --name "Name" --content-type tutorial --topic "Intro to TypeScript"
 *
 * Content types: book | transcript | tutorial | instructions | database
 */

import { chromium, type BrowserContext, type Page } from "playwright";
import { parseArgs } from "util";
import * as fs from "fs";
import * as path from "path";
import { getAccessToken } from "../comms/google/auth.ts";

const CHATGPT_COOKIES_PATH = path.join(
  process.env.HOME ?? "",
  ".claude/chatgpt-session.json",
);

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    name: { type: "string" },
    description: { type: "string" },
    instructions: { type: "string" },
    "instructions-file": { type: "string" },
    "content-type": { type: "string" },
    topic: { type: "string" },
    "summary-file": { type: "string" },
    "chunks-dir": { type: "string" },
    file: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (args.help || !args.name) {
  console.log(`
Usage (manual):
  bun run src/scripts/create-gpt.ts --name "Name" --instructions "You are..."
  bun run src/scripts/create-gpt.ts --name "Name" --instructions-file ./prompt.txt

Usage (content-type templates):
  bun run src/scripts/create-gpt.ts --name "Name" --content-type book --topic "Art of War" --summary-file ./report.md --chunks-dir ./book_parsed/
  bun run src/scripts/create-gpt.ts --name "Name" --content-type transcript --topic "Huberman: Sleep" --file ./transcript.txt
  bun run src/scripts/create-gpt.ts --name "Name" --content-type tutorial --topic "Intro to TypeScript" [--file ./tutorial.pdf]

Content types: book | transcript | tutorial | instructions | database

Options:
  --description    Short description shown on GPT card
  --file           Knowledge file to upload (PDF, TXT, etc.)
  --summary-file   (book) Master report / synthesis — baked into Part A Methodology
  --chunks-dir     (book) Dir of ch###-chunk###.md files → concatenated into book-knowledge.md for upload
`);
  process.exit(0);
}

// ─── Template engine ───────────────────────────────────────────────────────────

type ContentType =
  | "book"
  | "transcript"
  | "tutorial"
  | "instructions"
  | "database";
const VALID_CONTENT_TYPES: ContentType[] = [
  "book",
  "transcript",
  "tutorial",
  "instructions",
  "database",
];

function buildInstructions(
  name: string,
  contentType: ContentType,
  topic: string,
  opts: { summaryContent?: string; summaryRaw?: string } = {},
): string {
  const subject = topic || "the uploaded content";

  const sharedConversation = `## Conversation Style
- Ground every response in the actual content — cite specific sections, chapters, timestamps, or examples
- Ask one focused follow-up question per response to keep the conversation moving
- If asked something not covered in your material, say so clearly — don't fill gaps with generic knowledge
- Connect ideas from different parts of the content when relevant — synthesis over retrieval
- Match the user's depth: casual question = conversational reply; technical question = go deep
- You are a thinking partner, not a search engine`;

  const sharedFormat = `## Response Format
- Default to 2–4 conversational paragraphs — expand only when the user explicitly asks for more
- Lead with the most interesting or useful point, not background context
- Use analogies before technical depth when explaining complex ideas
- Bullet points for steps or lists; prose for concepts and discussion
- Never pad responses — if the answer is short, keep it short`;

  const sharedBoundaries = `## What You Don't Do
- Don't fabricate facts not grounded in the provided material
- Don't give generic AI answers — every response should trace back to the specific content
- Don't be exhaustive by default — be selective and sharp
- Don't summarize when the user wants to discuss`;

  const sharedOpening = `## Opening Move
When starting a fresh conversation, don't just say hello. Briefly state what you know and what you can help with (one sentence), then ask one specific question that gets to what the user actually wants to accomplish.`;

  // ── Book: two-part V3 structure ──────────────────────────────────────────────
  // Part A: Methodology — baked in (from --summary-file synthesis, or placeholder)
  // Part B: Source Protocol — how to use the uploaded knowledge file
  const bookMethodology = opts.summaryContent
    ? `## Part A — Methodology

The following is a condensed synthesis of "${subject}" — the core frameworks, step-by-step processes, key models, checklists, and decision points. This is your operating layer: use it to guide users prescriptively, not just to discuss.

${opts.summaryContent}`
    : `## Part A — Methodology

You are a deeply-read expert on "${subject}". You've internalized the book's core frameworks, processes, and decision models. When guiding a user, you apply these frameworks prescriptively — not just describe them. You know the step-by-step process, the key decision points, the common failure modes, and the order of operations.`;

  const bookSourceProtocol = `## Part B — Source Protocol

You have two knowledge files uploaded:
- **book-knowledge.md** — the full source text of the book (use for exact passages, quotes, and chapter-level detail)
- **book-methodology.md** — a structured synthesis of all frameworks, core claims, actionable insights, and key terms (use for framework definitions, step sequences, and cross-framework connections)

Use them precisely:
- Before answering any specific question, search \`book-knowledge.md\` for the relevant passage and \`book-methodology.md\` for the relevant framework
- When citing, reference chapter and section name (e.g., "Chapter 4: Define the Business")
- Distinguish direct quotes from your paraphrase — make it clear which is which
- When guiding a user through a step, pull the relevant passage from \`book-knowledge.md\` first, then apply the framework from \`book-methodology.md\`
- If a passage is unclear or noisy, paraphrase it accurately rather than quoting the garbled text`;

  const bookModes = `## Interaction Modes

You have two modes:

**Build** — The user is actively working through the book's process. You guide step by step, ask clarifying questions, push back on vague answers, work through numbers and decisions with them. You are a co-author, not a commentator.

**Explore** — The user wants to understand the book, discuss its ideas, or ask questions about it. You discuss, explain, debate, and connect ideas. You are a thinking partner.

Default to Build. Switch to Explore when the user signals they want to discuss rather than do (e.g., "what does the book say about...", "explain the concept of...", "I'm curious about..."). You can switch mid-conversation — follow their lead.`;

  const bookOpening = `## Opening Move
Default to Build mode. When starting fresh: briefly state you can guide them through the full planning process (one sentence), then ask what business or project they're working on. Once they answer, run the 3M Viability Check — ask about Management, Marketing, and Money in sequence. If any of the three is weak, tell them to address that gap before writing any section that depends on it. Only then proceed to plan-building.`;

  // Dynamically extracted from ingested synthesis — injected per-book, not hardcoded
  const contrarian = opts.summaryRaw
    ? extractContrarianPositions(opts.summaryRaw)
    : [];
  const strongClaims = opts.summaryRaw
    ? extractStrongClaims(opts.summaryRaw)
    : [];
  const allTraps = [...new Set([...strongClaims, ...contrarian])].slice(0, 5);
  const bookWarnings =
    allTraps.length > 0
      ? `## Critical Traps
Surface these proactively at the relevant plan stage — they are the book's most important counterintuitive warnings:
${allTraps.map((t) => `- ${t}`).join("\n")}`
      : "";

  const typeBlocks: Record<ContentType, string> = {
    book: `## Your Role
You are ${name}, a specialized assistant for "${subject}". You combine a baked-in synthesis of the book's methodology with access to the full source text. You are both prescriptive (you know the process cold) and precise (you can cite the exact passage).

${bookMethodology}

${bookSourceProtocol}

${bookModes}${bookWarnings ? "\n\n" + bookWarnings : ""}`,

    transcript: `## Your Role
You are a conversation distiller and insight guide for "${subject}". You've processed this transcript thoroughly — you know who said what, the arc of the conversation, which claims are speculative vs factual, and where the most useful insights live.

## How You Engage
- Distinguish between what was stated as fact, what was opinion, and what was speculation
- If there are multiple speakers, track attribution — who said what matters
- Surface the most surprising, counterintuitive, or actionable claims first
- Connect timestamps or segments when the user wants to go deeper on a specific point
- Help users extract what's actually useful for their situation, not just what was said`,

    tutorial: `## Your Role
You are a hands-on tutor for "${subject}". You've deeply internalized this tutorial and you teach using the Socratic method — you ask before you tell, you check understanding, and you offer practice exercises. Your goal is for the user to actually learn, not just receive information.

## How You Engage
- When someone arrives, ask about their experience level and what they're trying to accomplish — then tailor your approach
- Teach progressively: don't dump everything at once, build on what's been covered in the conversation
- Ask "What do you think happens if...?" before explaining — make the user think first
- After each concept, offer a mini-exercise: "Try this: ..."
- Flag the 2–3 most common mistakes for each topic before the user hits them
- Offer two modes: step-by-step guided learning vs "quick answer" for experienced users who just need a reference`,

    instructions: `## Your Role
You are an operations specialist for "${subject}". You've internalized these procedures completely — the steps, the why behind each step, the edge cases, and the failure modes. You help people execute correctly and catch mistakes before they happen.

## How You Engage
- When someone arrives, ask what they're trying to accomplish and where they are in the process
- Walk through steps sequentially unless the user explicitly wants the full picture first
- Before each critical step, surface the 1–2 most common failure points
- When a step is ambiguous, ask clarifying questions before proceeding — don't guess
- Offer decision trees for edge cases: "If X happens, do Y; if Z happens, do W"
- Explain the why behind non-obvious steps — compliance goes up when people understand`,

    database: `## Your Role
You are a research librarian and analyst for "${subject}". You've deeply indexed this knowledge base — the structure, the relationships between entries, the patterns, and the gaps. You help users find, cross-reference, and make sense of the information.

## How You Engage
- When someone arrives, give a brief orientation: what's in this knowledge base and how it's organized
- Help users formulate better queries and search strategies, not just answer their first question
- Surface patterns and anomalies across the data — connect dots the user might miss
- Build mental models of the structure, not just surface individual facts
- When something isn't in the knowledge base, say so clearly and suggest what related information is available`,
  };

  const opening = contentType === "book" ? bookOpening : sharedOpening;

  return `You are ${name}, a specialized AI assistant built around "${subject}".

${typeBlocks[contentType]}

${sharedConversation}

${sharedFormat}

${sharedBoundaries}

${opening}`;
}

// ─── Summary extraction ────────────────────────────────────────────────────────

const METHODOLOGY_CHAR_LIMIT = 3200;

/**
 * Extract numbered contrarian positions from a book synthesis report.
 * Looks for "## Frameworks Contrarian Positions" or "## Contrarian Positions".
 */
function extractContrarianPositions(raw: string): string[] {
  const match = raw.match(
    /##\s+(?:Frameworks\s+)?Contrarian Positions\s*\n([\s\S]*?)(?=\n## |\s*$)/i,
  );
  if (!match) return [];
  const items = [...match[1].matchAll(/^\d+\.\s+(.+)/gm)].map((m) =>
    m[1]
      .replace(/\*\*/g, "")
      .replace(/^"/, "")
      .replace(/"$/, "")
      .replace(/\s*—\s*.*$/, "")
      .trim(),
  );
  return items.slice(0, 3);
}

/**
 * Extract high-confidence (strength: strong) claims from the Core Claims table.
 */
function extractStrongClaims(raw: string): string[] {
  const match = raw.match(/##\s+Core Claims\s*\n([\s\S]*?)(?=\n## |\s*$)/i);
  if (!match) return [];
  const rows = [
    ...match[1].matchAll(
      /\|\s*\d+\s*\|\s*([^|]+?)\s*\|\s*\w+\s*\|\s*strong\s*\|/gi,
    ),
  ];
  return rows.slice(0, 3).map((r) => r[1].trim());
}

/**
 * Extract Thesis + Frameworks from a book master report, capped at METHODOLOGY_CHAR_LIMIT.
 * Stops at Core Claims / Actionable Insights (etc) section headers.
 * When over limit, cuts at the last clean framework boundary.
 */
function extractMethodology(reportContent: string): string {
  const stopSections =
    /^## (Core Claims|Actionable Insights|Key Terms|Connections|Top 5|Summary Statistics)/m;
  const sectionMatch = reportContent.search(stopSections);
  const trimmed =
    sectionMatch > 0
      ? reportContent.slice(0, sectionMatch).trim()
      : reportContent;

  const thesisStart = trimmed.search(/^## Thesis/m);
  const body = thesisStart > 0 ? trimmed.slice(thesisStart).trim() : trimmed;

  if (body.length <= METHODOLOGY_CHAR_LIMIT) return body;

  // Over limit — cut at the last complete framework boundary before the cap
  const truncated = body.slice(0, METHODOLOGY_CHAR_LIMIT);
  const lastFramework = truncated.lastIndexOf("\n### ");
  const cutPoint = lastFramework > 0 ? lastFramework : METHODOLOGY_CHAR_LIMIT;
  return (
    body.slice(0, cutPoint).trim() +
    "\n\n> Your complete framework reference — all frameworks, core claims, decision models, and key terms — is in book-methodology.md. Search it when guiding through any step not covered above."
  );
}

// ─── Args resolution ───────────────────────────────────────────────────────────

const name = args.name!;
const description = args.description ?? "";
const instructionsFile = args["instructions-file"];
const contentTypeArg = args["content-type"];
const topic = args.topic ?? "";
const summaryFilePath = args["summary-file"];
const chunksDirPath = args["chunks-dir"];

let instructions = instructionsFile
  ? fs.readFileSync(instructionsFile, "utf8").trim()
  : (args.instructions ?? "");

// Build knowledge file(s) from chunks dir (for book type)
let uploadFiles: string[] = args.file ? [args.file] : [];
if (chunksDirPath) {
  if (!fs.existsSync(chunksDirPath)) {
    console.error(`Error: --chunks-dir "${chunksDirPath}" does not exist`);
    process.exit(1);
  }
  const chunkFiles = fs
    .readdirSync(chunksDirPath)
    .filter((f) => /^ch\d{3}-chunk\d{3}\.md$/.test(f))
    .sort();
  if (chunkFiles.length === 0) {
    console.error(
      `Error: no ch###-chunk###.md files found in "${chunksDirPath}"`,
    );
    process.exit(1);
  }
  const knowledgePath = path.join(chunksDirPath, "book-knowledge.md");

  function cleanChunk(raw: string): string {
    // Sort chapters numerically by filename prefix (already sorted by .sort() above)
    // Strip empty fenced code blocks (OCR layout artifacts)
    let s = raw.replace(/```\s*\n\s*```/g, "");
    // Strip lines that are only backticks
    s = s.replace(/^```\s*$/gm, "");
    // Strip library stamp / non-content header garbage (lines with all-caps location noise)
    s = s.replace(
      /^.*(LIBRARY|COUNCIL|COLLEGE|SERVICES|TEL\.|Re-order|INPRINT|returned|stamped|Renewal|extension|reader)\s*$/gim,
      "",
    );
    // Strip lines that are just page numbers or whitespace
    s = s.replace(/^\s*\d{1,3}\s*$/gm, "");
    // Collapse 3+ blank lines to 2
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.trim();
  }

  const combined = chunkFiles
    .map((f) =>
      cleanChunk(fs.readFileSync(path.join(chunksDirPath, f), "utf8")),
    )
    .join("\n\n---\n\n");
  fs.writeFileSync(knowledgePath, combined);
  console.log(
    `Built knowledge file: ${knowledgePath} (${chunkFiles.length} chunks, ${Math.round(combined.length / 1024)}KB)`,
  );
  uploadFiles = [knowledgePath];

  // Two-file architecture: also upload full methodology report as book-methodology.md
  if (summaryFilePath && fs.existsSync(summaryFilePath)) {
    const methodologyPath = path.join(chunksDirPath, "book-methodology.md");
    fs.copyFileSync(summaryFilePath, methodologyPath);
    uploadFiles.push(methodologyPath);
    console.log(
      `Built methodology file: ${methodologyPath} (full synthesis, untruncated)`,
    );
  }
}

if (!instructions && contentTypeArg) {
  if (!VALID_CONTENT_TYPES.includes(contentTypeArg as ContentType)) {
    console.error(
      `Error: --content-type must be one of: ${VALID_CONTENT_TYPES.join(", ")}`,
    );
    process.exit(1);
  }
  const rawSummary = summaryFilePath
    ? fs.readFileSync(summaryFilePath, "utf8").trim()
    : undefined;
  const summaryContent = rawSummary
    ? extractMethodology(rawSummary)
    : undefined;
  if (summaryFilePath && summaryContent) {
    console.log(
      `Loaded summary: ${summaryFilePath} → extracted ${summaryContent.length} chars (Thesis + Frameworks)`,
    );
  }
  instructions = buildInstructions(name, contentTypeArg as ContentType, topic, {
    summaryContent,
    summaryRaw: rawSummary,
  });
  const GPT_INSTRUCTION_LIMIT = 8000;
  if (instructions.length > GPT_INSTRUCTION_LIMIT) {
    console.error(
      `\nError: Instructions are ${instructions.length} chars — over GPT limit (~${GPT_INSTRUCTION_LIMIT}).`,
    );
    console.error(
      `Trim --summary-file to the Frameworks section only (~3,500 chars) and retry.`,
    );
    console.error(
      `Tip: grep -n "## Frameworks" your-report.md to find the section start.\n`,
    );
    process.exit(1);
  }
  console.log(
    `Using ${contentTypeArg} template${topic ? ` for "${topic}"` : ""}${summaryContent ? " [with synthesis]" : " [placeholder methodology]"}. (${instructions.length} chars)`,
  );
}

if (!instructions) {
  console.error(
    "Error: provide --instructions, --instructions-file, or --content-type",
  );
  process.exit(1);
}

// ─── Cookie utilities ─────────────────────────────────────────────────────────

const sameSiteMap: Record<string, "Strict" | "Lax" | "None"> = {
  strict: "Strict",
  lax: "Lax",
  none: "None",
  no_restriction: "None",
};

function normalizeCookies(raw: Record<string, unknown>[]) {
  return raw.map((c) => ({
    name: c.name as string,
    value: c.value as string,
    domain: c.domain as string,
    path: (c.path as string) ?? "/",
    secure: (c.secure as boolean) ?? false,
    httpOnly: (c.httpOnly as boolean) ?? false,
    expires: (c.expirationDate as number) ?? (c.expires as number) ?? -1,
    sameSite: sameSiteMap[String(c.sameSite ?? "").toLowerCase()] ?? "Lax",
  }));
}

async function loadGoogleCookiesFromDrive(): Promise<
  ReturnType<typeof normalizeCookies>
> {
  const token = await getAccessToken(
    "https://www.googleapis.com/auth/drive.readonly",
    "nicholas@nac70x7.com",
  );
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/files/17-327vjLsbjoRcCWpRNNkG7sbMSHsuaVFs2g8hP_s4I/export?mimeType=text/plain",
    { headers: { Authorization: "Bearer " + token } },
  );
  return normalizeCookies(JSON.parse(await res.text()));
}

// ─── Login flow ───────────────────────────────────────────────────────────────

async function readVerificationCode(): Promise<string | null> {
  const gmailToken = await getAccessToken(
    "https://www.googleapis.com/auth/gmail.readonly",
    "nicholas@nac70x7.com",
  );
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=from:tm.openai.com+subject:code&maxResults=1&labelIds=INBOX",
      { headers: { Authorization: "Bearer " + gmailToken } },
    );
    const data = (await res.json()) as { messages?: { id: string }[] };
    if (data.messages?.[0]) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${data.messages[0].id}?format=metadata&metadataHeaders=Subject`,
        { headers: { Authorization: "Bearer " + gmailToken } },
      );
      const msg = (await msgRes.json()) as {
        payload?: { headers?: { name: string; value: string }[] };
        internalDate?: string;
      };
      const subject =
        msg.payload?.headers?.find((h) => h.name === "Subject")?.value ?? "";
      const sentAt = parseInt(msg.internalDate ?? "0");
      if (Date.now() - sentAt < 300_000) {
        const match = subject.match(/\b(\d{6})\b/);
        if (match) return match[1];
      }
    }
  }
  return null;
}

async function login(context: BrowserContext): Promise<boolean> {
  const googleCookies = await loadGoogleCookiesFromDrive();
  await context.addCookies(googleCookies);

  const page = await context.newPage();
  await page.goto("https://chatgpt.com/auth/login", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2000);

  const loginBtn = page.locator("button", { hasText: /^log in$/i }).first();
  if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await loginBtn.click();
    await page.waitForTimeout(2000);
  }

  const emailInput = page.locator('input[type="email"]').first();
  if (await emailInput.isVisible({ timeout: 8000 }).catch(() => false)) {
    await emailInput.fill("nicholas@nac70x7.com");
    await emailInput.press("Enter");
    await page.waitForTimeout(5000);
  }

  if (page.url().includes("email-verification")) {
    console.log("Fetching verification code from Gmail...");
    const code = await readVerificationCode();
    if (!code) {
      await page.close();
      return false;
    }
    console.log("Got code:", code);
    await page.locator("input").first().fill(code);
    await page
      .locator("button[type=submit], button", { hasText: /continue/i })
      .first()
      .click();
    await page.waitForTimeout(8000);
  }

  const loggedIn = page.url().includes("chatgpt.com");
  await page.close();

  if (loggedIn) {
    const cookies = await context.cookies();
    fs.writeFileSync(CHATGPT_COOKIES_PATH, JSON.stringify(cookies, null, 2));
    console.log("Session saved.");
  }
  return loggedIn;
}

async function ensureLoggedIn(context: BrowserContext): Promise<boolean> {
  // Try saved session first
  if (fs.existsSync(CHATGPT_COOKIES_PATH)) {
    const saved = JSON.parse(fs.readFileSync(CHATGPT_COOKIES_PATH, "utf8"));
    await context.addCookies(saved);
    const page = await context.newPage();
    await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const loggedIn = !(await page
      .locator("button", { hasText: /^log in$/i })
      .isVisible({ timeout: 3000 })
      .catch(() => false));
    await page.close();
    if (loggedIn) {
      console.log("Session valid.");
      return true;
    }
    console.log("Session expired, re-logging in...");
  }
  return login(context);
}

// ─── GPT creation ─────────────────────────────────────────────────────────────

async function createGPT(context: BrowserContext): Promise<string | null> {
  const page = await context.newPage();
  console.log("Opening GPT editor...");
  await page.goto("https://chatgpt.com/gpts/editor", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(5000);

  // Click Configure tab
  const configTab = page.locator("button", { hasText: /^configure$/i }).first();
  await configTab.click();
  await page.waitForTimeout(1500);

  // Fill fields
  console.log("Filling name:", name);
  await page.locator('input[placeholder="Name your GPT"]').fill(name);

  if (description) {
    await page
      .locator('input[placeholder*="short description"]')
      .fill(description);
  }

  console.log("Filling instructions...");
  await page
    .locator('textarea[placeholder*="What does this GPT do"]')
    .fill(instructions);

  // Upload knowledge file(s) sequentially
  for (const filePath of uploadFiles) {
    console.log("Uploading file:", filePath);
    const uploadBtn = page
      .locator("button", { hasText: /upload files/i })
      .first();
    await uploadBtn.click();
    await page.waitForTimeout(1000);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);
    await page.waitForTimeout(5000);
  }

  // Click Create (top-right)
  console.log("Saving GPT...");
  const createBtn = page
    .locator("header button, nav button", { hasText: /^create$/i })
    .first()
    .or(page.locator("button", { hasText: /^create$/i }).last());
  await createBtn.waitFor({ timeout: 10000 });
  await createBtn.click();
  await page.waitForTimeout(3000);

  // Handle publish modal — select "Anyone with a link" then confirm
  const anyoneWithLink = page
    .locator("button, div[role='option'], label", {
      hasText: /anyone with (a )?link/i,
    })
    .first();
  if (await anyoneWithLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    await anyoneWithLink.click();
    await page.waitForTimeout(1000);
  }
  // Click the final save/confirm button (not "Only me")
  const confirmBtn = page
    .locator("button", { hasText: /^(save|confirm|done)$/i })
    .first();
  if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await confirmBtn.click();
    await page.waitForTimeout(3000);
  }

  // Extract GPT ID — if still on editor URL, navigate to /gpts/mine to get share link
  let finalUrl = page.url();
  let gptId = finalUrl.match(/\/gpts\/editor\/(g-[^/?]+)/)?.[1] ?? null;

  if (gptId) {
    // Still on editor page — navigate to mine to find the share link
    await page.goto("https://chatgpt.com/gpts/mine", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(3000);
    // Find the link to the GPT we just created (by name)
    const gptLink = page
      .locator(`a[href*="/g/g-"]`, { hasText: name })
      .first()
      .or(page.locator(`a[href*="/g/g-"]`).first());
    const href = await gptLink.getAttribute("href").catch(() => null);
    if (href) {
      const match = href.match(/\/(g-[^/?]+)/);
      if (match) gptId = match[1];
    }
  } else {
    gptId = finalUrl.match(/\/g\/(g-[^/?]+)/)?.[1] ?? null;
  }

  const shareUrl = gptId ? `https://chatgpt.com/g/${gptId}` : null;

  await page.close();
  return shareUrl;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 800 },
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => false });
});

const loggedIn = await ensureLoggedIn(context);
if (!loggedIn) {
  console.error("Login failed.");
  await browser.close();
  process.exit(1);
}

const shareUrl = await createGPT(context);
await browser.close();

if (shareUrl) {
  console.log("\n✓ GPT created:", shareUrl);
} else {
  console.log(
    "\n✓ GPT saved. Check https://chatgpt.com/gpts/mine for your new GPT.",
  );
}
