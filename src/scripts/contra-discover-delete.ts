import { chromium } from "playwright";
import * as fs from "fs";

const CREDENTIALS_PATH = "/home/na/.config/eddie-accounts/credentials.json";
const SCREENSHOT_DIR = "/home/na/.claude/playwright-output/contra-profile";
const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8")) as any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-popup-blocking"] });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
});
await context.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
const page = await context.newPage();

// Full login with session establishment
await page.goto("https://contra.com", { waitUntil: "domcontentloaded" });
const loginBtn = page.locator("a, button").filter({ hasText: /^log in$/i }).first();
await Promise.race([loginBtn.waitFor({ timeout: 20000 }).catch(() => {}), page.getByText(/having trouble/i).waitFor({ timeout: 20000 }).catch(() => {})]);

if (await loginBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
  await loginBtn.click();
  const googleBtn = page.locator("button").filter({ hasText: /continue with google/i }).first();
  await googleBtn.waitFor({ timeout: 12000 }).catch(() => {});
  if (await googleBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    const [popup] = await Promise.all([context.waitForEvent("page"), googleBtn.click()]) as any;
    await popup.waitForLoadState("networkidle");
    await popup.locator('input[type="email"]').first().fill(creds.google_workspace.email);
    await popup.getByRole("button", { name: /next/i }).click();
    await sleep(2000);
    await popup.locator('input[type="password"]').first().fill(creds.google_workspace.password);
    await popup.getByRole("button", { name: /next/i }).click();
    await sleep(4000);
    const allow = popup.getByRole("button", { name: /allow|continue|yes/i }).first();
    if (await allow.isVisible({ timeout: 5000 }).catch(() => false)) await allow.click();
    await popup.waitForEvent("close", { timeout: 20000 }).catch(() => {});
    // Wait for main page to complete OAuth redirect
    await page.waitForURL(/contra\.com/, { timeout: 15000 }).catch(() => {});
    await sleep(3000);
  }
}
console.log("Post-login URL:", page.url());

// Verify session — navigate to a protected page
await page.goto("https://contra.com/community/for-you", { waitUntil: "networkidle" });
await sleep(2000);
console.log("Protected page URL:", page.url());
await page.screenshot({ path: `${SCREENSHOT_DIR}/session-check.png` });

// Explore dashboard for service management
const dashUrls = [
  "https://contra.com/?view=projects",
  "https://contra.com/dashboard",
  "https://contra.com/profile/edit",
  "https://contra.com/settings/services",
];

for (const url of dashUrls) {
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
  await sleep(2000);
  if (page.url().includes(url.split("contra.com")[1]?.split("?")[0] ?? "NOMATCH")) {
    console.log(`\n✅ Accessible: ${url} → ${page.url()}`);
    const btns = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button, a"))
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0; })
        .map(el => ({ text: (el as HTMLElement).innerText?.trim().slice(0, 40), href: (el as HTMLAnchorElement).href }))
        .filter(e => /service|edit|delete|manage|draft/i.test(e.text + (e.href ?? "")))
        .slice(0, 15)
    );
    if (btns.length) console.log("Service-related controls:", JSON.stringify(btns, null, 2));
    await page.screenshot({ path: `${SCREENSHOT_DIR}/dash-${url.replace(/[^a-z0-9]/gi, "_").slice(-20)}.png` });
  } else {
    console.log(`❌ Redirected: ${url} → ${page.url()}`);
  }
}

// Try navigating to service edit URL directly (from the known published service)
await page.goto("https://contra.com/s/3PEOeqg2-cinematic-ai-website-48-hour-delivery", { waitUntil: "networkidle" });
await sleep(2000);
console.log("\nPublished service page URL:", page.url());
const servicePageBtns = await page.evaluate(() =>
  Array.from(document.querySelectorAll("button, a, [role='button']"))
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0; })
    .map(el => ({ text: (el as HTMLElement).innerText?.trim().slice(0, 50), href: (el as HTMLAnchorElement).href, aria: el.getAttribute("aria-label") }))
    .filter(e => e.text || e.aria)
    .slice(0, 30)
);
console.log("Buttons on published service:", JSON.stringify(servicePageBtns, null, 2));
await page.screenshot({ path: `${SCREENSHOT_DIR}/published-service-owner-view.png` });

await browser.close();
