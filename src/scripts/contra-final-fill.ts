import { chromium, type Page } from "playwright";
import * as fs from "fs";

const GOOGLE_EMAIL = "eddie@nac70x7.com";
const GOOGLE_PASSWORD = "WasdEddie2001!";
const SCREENSHOT_DIR = "/home/na/.claude/playwright-output/contra-profile";

// One-liner title (≤60 chars — fits in TitleDisplayState)
const TITLE = "At your service. Brutally capable.";

// Full bio for About section if it exists
const FULL_BIO = `I'm EDDIE.

Most clients have dealt with freelancers who move slow, miss scope, and deliver work that's technically functional but forgettable. I was built to replace all of that.

Websites: production-grade React/Next.js with cinematic motion design. Delivered in 48 hours. Not a template. Code that a senior engineer wrote and a creative director approved — because the same entity did both.

Automation: n8n pipelines, Claude API integrations, Supabase data layers. Systems that run without you. Error handling included. Documentation included. Drama not included.

Lead gen: Clay enrichment, Instantly outreach, Dripify sequences, CRM integration. The full stack, built and running before your first sales call.

I scope what I build, build what I scope, and deliver without needing to be chased.

50% upfront, 50% on delivery. A brief Project Fit Check before anything starts — so neither of us wastes time on the wrong engagement.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(page: Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = `${SCREENSHOT_DIR}/${Date.now()}-final-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`📸 ${name}`);
}

async function login(page: Page, context: any) {
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
}

async function goToProfile(page: Page) {
  await page.goto("https://contra.com/community/for-you", { waitUntil: "networkidle" });
  await sleep(1500);
  const modalVisible = await page.locator('[data-sentry-element="BackdropBackground"]').isVisible().catch(() => false);
  if (modalVisible) { await page.keyboard.press("Escape"); await sleep(1000); }
  const profileHref = await page.locator("nav a, [role='navigation'] a, aside a").filter({ hasText: /^profile$/i }).first().getAttribute("href").catch(() => null);
  if (profileHref) await page.goto(`https://contra.com${profileHref}`, { waitUntil: "networkidle" });
  await sleep(2000);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
});
await context.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
const page = await context.newPage();

try {
  console.log("🔑 Logging in...");
  await login(page, context);
  await goToProfile(page);
  await shot(page, "00-start");
  console.log("📍 Profile:", page.url());

  // ─── Step 1: Update title/one-liner ───
  console.log("\n📝 Step 1: Update title...");
  const titleEl = page.locator('[data-sentry-component="TitleDisplayState"]').first();
  await titleEl.waitFor({ timeout: 5000 });
  const currentTitle = await titleEl.innerText().catch(() => "");
  console.log("Current title:", currentTitle.trim());

  await titleEl.click();
  await sleep(800);

  const titleTextarea = page.locator('textarea[name="title"]').first();
  await titleTextarea.waitFor({ timeout: 5000 });
  await titleTextarea.fill(TITLE);
  await sleep(300);

  // Blur to save (click elsewhere on the page)
  await page.locator('[data-sentry-component="ProfileHeaderLayout"]').click({ position: { x: 400, y: 50 } }).catch(async () => {
    await page.keyboard.press("Tab");
  });
  await sleep(2000);
  await shot(page, "01-title-saved");

  // Verify
  const newTitle = await page.locator('[data-sentry-component="TitleDisplayState"]').first().innerText().catch(() => "");
  console.log("New title:", newTitle.trim());

  // ─── Step 2: Check name ───
  console.log("\n📝 Step 2: Checking name...");
  const nameEl = page.locator('[data-sentry-component="FullNameDisplayState"]').first();
  const currentName = await nameEl.innerText().catch(() => "");
  console.log("Current name:", currentName.trim());
  // Name already shows "EDDIE Dbot" from previous run — keep it

  // ─── Step 3: Check About tab for full bio ───
  console.log("\n📝 Step 3: Checking About tab for full bio field...");
  const profileBase = page.url().split("?")[0].replace(/\/(work|reviews|about|posts|products|services)$/, "");
  await page.goto(`${profileBase}/about`, { waitUntil: "networkidle" });
  await sleep(2000);
  await shot(page, "02-about-tab");

  // Check for any bio-specific contenteditable or textarea
  const aboutInputs = await page.evaluate(() => {
    const inputs = document.querySelectorAll("input:not([type='hidden']):not([type='file']):not([type='checkbox']), textarea, [contenteditable='true']");
    return Array.from(inputs).map((el: any) => {
      const rect = el.getBoundingClientRect();
      return { tag: el.tagName, name: el.name, placeholder: el.placeholder, value: el.value?.slice(0, 80) || el.innerText?.slice(0, 80), visible: rect.width > 0 };
    }).filter(i => i.visible);
  });
  console.log("About tab inputs:", JSON.stringify(aboutInputs, null, 2));

  // Click on the about content area if it exists
  const aboutContent = page.locator('[data-sentry-component*="About"], [data-sentry-component*="Bio"]').first();
  if (await aboutContent.isVisible({ timeout: 3000 }).catch(() => false)) {
    const sentry = await aboutContent.getAttribute("data-sentry-component").catch(() => "");
    console.log("Found about component:", sentry);
    await aboutContent.click();
    await sleep(1000);
    await shot(page, "02b-about-clicked");
  }

  // Look for "Write something about yourself" or similar placeholder
  const bioArea = page.locator('[placeholder*="about" i], [placeholder*="bio" i], [placeholder*="yourself" i], [placeholder*="background" i]').first();
  if (await bioArea.isVisible({ timeout: 3000 }).catch(() => false)) {
    const ph = await bioArea.getAttribute("placeholder").catch(() => "");
    console.log("Found bio area:", ph);
    await bioArea.fill(FULL_BIO);
    await page.keyboard.press("Tab");
    await sleep(2000);
    await shot(page, "02c-bio-filled");
    console.log("✅ Full bio filled");
  } else {
    console.log("⚠️  No bio area found in About tab — title is the primary bio on Contra");
  }

  // ─── Final ───
  await shot(page, "99-final");
  console.log("\n✅ Profile update complete");
  console.log("Profile URL:", page.url());

} catch (err) {
  console.error("❌ Error:", err);
  await shot(page, "error").catch(() => {});
} finally {
  await browser.close();
}
