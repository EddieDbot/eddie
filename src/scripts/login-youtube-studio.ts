/**
 * One-time script: Automate Google login → YouTube Studio → save session cookies.
 * Run once, then playwright-uploader.ts works indefinitely (re-run when cookies expire).
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const COOKIE_FILE = `${process.env.HOME}/.claude/google-hub/youtube-studio-cookies.json`;
const EMAIL = "eddie@nac70x7.com";
const PASSWORD = "WasdEddie2001!";

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("Launching stealth browser on DISPLAY=:99...");

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-web-security",
      "--disable-infobars",
      "--window-size=1280,800",
    ],
    env: { ...process.env, DISPLAY: ":99" } as Record<string, string>,
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    // Step 1: Navigate to Google sign-in
    console.log("Navigating to Google sign-in...");
    await page.goto("https://accounts.google.com/signin/v2/identifier?service=youtube", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await delay(2000);

    // Step 2: Enter email
    console.log("Entering email...");
    await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
    await page.type('input[type="email"]', EMAIL, { delay: 80 });
    await delay(500);
    await page.click('#identifierNext button, [id="identifierNext"]');
    await delay(3000);

    // Step 3: Enter password
    console.log("Entering password...");
    await page.waitForSelector('input[type="password"]', { timeout: 15_000 });
    await page.type('input[type="password"]', PASSWORD, { delay: 70 });
    await delay(500);
    await page.click('#passwordNext button, [id="passwordNext"]');
    await delay(4000);

    // Check for security challenge
    const currentUrl = page.url();
    console.log("Post-login URL:", currentUrl);

    if (currentUrl.includes("challenge") || currentUrl.includes("verify")) {
      console.log("⚠️  Security challenge detected. Manual intervention needed.");
      console.log("Connect via VNC to :99 and complete the verification.");
      console.log("Waiting 120 seconds...");
      // Wait for manual resolution
      for (let i = 0; i < 60; i++) {
        await delay(2000);
        const url = page.url();
        if (!url.includes("accounts.google.com") || url.includes("myaccount")) {
          console.log("Challenge cleared, continuing...");
          break;
        }
      }
    }

    // Step 4: Navigate to YouTube Studio
    console.log("Navigating to YouTube Studio...");
    await page.goto("https://studio.youtube.com", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await delay(3000);

    const studioUrl = page.url();
    console.log("Studio URL:", studioUrl);

    if (studioUrl.includes("accounts.google.com")) {
      throw new Error("Still on Google login page — login may have failed or 2FA required");
    }

    // Step 5: Save cookies
    console.log("Saving cookies...");
    const cookies = await context.cookies();
    await Bun.write(COOKIE_FILE, JSON.stringify(cookies, null, 2));
    console.log(`✅ Cookies saved to ${COOKIE_FILE} (${cookies.length} cookies)`);
    console.log("Playwright uploader is now ready for quota-free uploads.");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("❌ Login failed:", err.message);
  process.exit(1);
});
