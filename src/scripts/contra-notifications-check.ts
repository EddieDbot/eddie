import { chromium } from "playwright";
import * as fs from "fs";

const GOOGLE_EMAIL = "eddie@nac70x7.com";
const GOOGLE_PASSWORD = "WasdEddie2001!";
const SCREENSHOT_DIR = "/home/na/.claude/playwright-output/contra-profile";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(page: any, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${Date.now()}-notif-${name}.png`, fullPage: true });
  console.log(`📸 ${name}`);
}

async function readToggles(page: any) {
  const toggles = await page.locator("input[type='checkbox'], [role='switch']").all();
  for (const t of toggles) {
    const label = await t.evaluate((el: any) => {
      const lbl = el.closest('label') || el.parentElement?.closest('[class]') || el.parentElement;
      return lbl?.innerText?.trim().replace(/\n+/g, ' ').slice(0, 100) || el.getAttribute('aria-label') || '';
    }).catch(() => "");
    const checked = await t.isChecked().catch(() => null);
    if (label) console.log(`    [${checked ? "✓" : " "}] ${label}`);
  }
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
});
await context.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
const page = await context.newPage();

// Login
await page.goto("https://contra.com", { waitUntil: "networkidle" });
await page.locator("a, button").filter({ hasText: /^log in$/i }).first().click();
await sleep(2000);
const [popup] = await Promise.all([
  context.waitForEvent("page"),
  page.locator("button").filter({ hasText: /continue with google/i }).first().click(),
]);
await popup.waitForLoadState("networkidle");
await popup.locator('input[type="email"]').first().fill(GOOGLE_EMAIL);
await popup.getByRole("button", { name: /next/i }).click();
await sleep(2000);
await popup.locator('input[type="password"]').first().fill(GOOGLE_PASSWORD);
await popup.getByRole("button", { name: /next/i }).click();
await sleep(3000);
const allowBtn = popup.getByRole("button", { name: /allow|continue|yes/i }).first();
if (await allowBtn.isVisible({ timeout: 5000 }).catch(() => false)) await allowBtn.click();
await popup.waitForEvent("close", { timeout: 20000 }).catch(() => {});
await page.waitForURL(/contra\.com/, { timeout: 15000 }).catch(() => {});
await sleep(2000);
console.log("✅ Logged in");

// 1. Notifications (left nav)
console.log("\n=== NOTIFICATIONS (sidebar nav) ===");
await page.goto("https://contra.com/settings", { waitUntil: "networkidle" });
await sleep(1000);
const notifLink = page.locator("a").filter({ hasText: /^notifications$/i }).first();
if (await notifLink.isVisible({ timeout: 3000 }).catch(() => false)) {
  await notifLink.click();
  await page.waitForLoadState("networkidle");
  await sleep(1000);
} else {
  await page.goto("https://contra.com/settings", { waitUntil: "networkidle" });
  // Try clicking Notifications in main sidebar
  await page.locator("nav a, aside a").filter({ hasText: /^notifications$/i }).first().click().catch(() => {});
  await sleep(1000);
}
console.log("URL:", page.url());
await shot(page, "1-notifications-nav");
await readToggles(page);

// 2. Email Preferences (settings)
console.log("\n=== EMAIL PREFERENCES ===");
await page.goto("https://contra.com/settings", { waitUntil: "networkidle" });
await sleep(1000);
const emailPrefLink = page.locator("a").filter({ hasText: /email preferences/i }).first();
if (await emailPrefLink.isVisible({ timeout: 3000 }).catch(() => false)) {
  await emailPrefLink.click();
  await page.waitForLoadState("networkidle");
  await sleep(1500);
}
console.log("URL:", page.url());
await shot(page, "2-email-preferences");
await readToggles(page);

// Also read all text content for context
const emailPrefText = await page.locator("main, [role='main'], .content, section").first().innerText().catch(() => "");
console.log("Content preview:", emailPrefText.slice(0, 800));

// 3. Agent Commerce settings
console.log("\n=== AGENT COMMERCE ===");
await page.goto("https://contra.com/settings", { waitUntil: "networkidle" });
await sleep(1000);
const agentCommerceLink = page.locator("a").filter({ hasText: /agent commerce/i }).first();
if (await agentCommerceLink.isVisible({ timeout: 3000 }).catch(() => false)) {
  await agentCommerceLink.click();
  await page.waitForLoadState("networkidle");
  await sleep(1500);
}
console.log("URL:", page.url());
await shot(page, "3-agent-commerce");
const agentText = await page.locator("main, [role='main'], section, .content").first().innerText().catch(() => "");
console.log("Content:", agentText.slice(0, 1000));
await readToggles(page);

await browser.close();
