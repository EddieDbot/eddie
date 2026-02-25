import { chromium } from "playwright";
import * as fs from "fs";

const SCREENSHOT_DIR = "/home/na/.claude/playwright-output/contra-profile";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(page: any, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = `${SCREENSHOT_DIR}/${Date.now()}-debug-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`📸 ${name}`);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();

await page.goto("https://contra.com", { waitUntil: "networkidle" });
await page.locator("a, button").filter({ hasText: /^log in$/i }).first().click();
await sleep(2000);
await shot(page, "01-modal");

// Get all buttons in modal
const buttons = await page.locator("button").all();
console.log(`All buttons (${buttons.length}):`);
for (const btn of buttons) {
  const text = await btn.innerText().catch(() => "");
  const visible = await btn.isVisible().catch(() => false);
  const disabled = await btn.isDisabled().catch(() => false);
  if (text.trim()) console.log(`  "${text.trim()}" visible=${visible} disabled=${disabled}`);
}

// Fill email
const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
await emailInput.fill("eddie@nac70x7.com");
await sleep(500);
await shot(page, "02-email-filled");

// Check buttons again after filling email
const buttons2 = await page.locator("button").all();
console.log(`\nButtons after email fill:`);
for (const btn of buttons2) {
  const text = await btn.innerText().catch(() => "");
  const visible = await btn.isVisible().catch(() => false);
  const disabled = await btn.isDisabled().catch(() => false);
  if (text.trim()) console.log(`  "${text.trim()}" visible=${visible} disabled=${disabled}`);
}

// Click Log in
const logInBtn = page.locator("button").filter({ hasText: /^log in$/i }).first();
await logInBtn.click();
await sleep(3000);
await shot(page, "03-after-click");
console.log("URL:", page.url());

// Check what's on page now
const bodyText = await page.locator("body").innerText();
console.log("Body snippet:", bodyText.slice(0, 300));

await browser.close();
