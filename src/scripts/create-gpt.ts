#!/usr/bin/env bun
/**
 * create-gpt.ts — Automate Custom GPT creation via Playwright
 *
 * Usage:
 *   bun run src/scripts/create-gpt.ts --name "Agent Name" --instructions "You are..."
 *   bun run src/scripts/create-gpt.ts --name "Name" --instructions "..." --description "Short desc" --file /path/to/knowledge.pdf
 *   bun run src/scripts/create-gpt.ts --name "Name" --instructions-file ./prompt.txt
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
    file: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (args.help || !args.name) {
  console.log(`
Usage:
  bun run src/scripts/create-gpt.ts --name "Name" --instructions "You are..."
  bun run src/scripts/create-gpt.ts --name "Name" --instructions-file ./prompt.txt [--description "..."] [--file ./knowledge.pdf]
`);
  process.exit(0);
}

const name = args.name!;
const description = args.description ?? "";
const instructionsFile = args["instructions-file"];
const instructions = instructionsFile
  ? fs.readFileSync(instructionsFile, "utf8").trim()
  : (args.instructions ?? "");

if (!instructions) {
  console.error("Error: --instructions or --instructions-file required");
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

  // Upload knowledge file if provided
  if (args.file) {
    console.log("Uploading file:", args.file);
    const uploadBtn = page
      .locator("button", { hasText: /upload files/i })
      .first();
    await uploadBtn.click();
    await page.waitForTimeout(1000);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(args.file);
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
