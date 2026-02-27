import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const CALLBACK_URL = "http://100.73.11.127:4007/integrations/social/x";
const WEBSITE_URL = "http://100.73.11.127:4007";

const browser = await chromium.launch({
  headless: false,
  executablePath: "/home/na/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
  args: ["--display=:99", "--no-sandbox", "--disable-setuid-sandbox"],
});

const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
});
const page = await context.newPage();

console.log("→ Navigating to X developer portal...");
await page.goto("https://developer.x.com/en/portal/dashboard", { waitUntil: "networkidle", timeout: 30000 });

const url = page.url();
console.log("→ URL:", url);
await page.screenshot({ path: "/tmp/x-dev-1.png" });

// Handle login redirect
if (url.includes("twitter.com") || url.includes("x.com/i/flow") || url.includes("login")) {
  console.log("→ Login page detected, filling credentials...");
  
  await page.waitForSelector('input[autocomplete="username"], input[name="text"]', { timeout: 10000 });
  await page.fill('input[autocomplete="username"], input[name="text"]', "EddieDbot");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "/tmp/x-dev-2.png" });
  
  // Password field
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  await page.fill('input[type="password"]', "Urb4na!1992");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(5000);
  
  console.log("→ Post-login URL:", page.url());
  await page.screenshot({ path: "/tmp/x-dev-3.png" });
}

// Navigate to app settings
console.log("→ Looking for app in portal...");
await page.waitForTimeout(2000);
await page.screenshot({ path: "/tmp/x-dev-4.png" });
console.log("→ Current URL:", page.url());

await browser.close();
console.log("→ Done. Check /tmp/x-dev-*.png");
