import { chromium } from "playwright";

const EMAIL = "eddie@nac70x7.com";
const PASSWORD = "EddieDbot2026!#";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Capture API responses
  page.on("response", async (res) => {
    if (res.url().includes("/auth") && res.request().method() === "POST") {
      const body = await res.text().catch(() => "");
      console.log(`POST ${res.url()} → ${res.status()}: ${body.substring(0, 300)}`);
    }
  });

  await page.goto("http://localhost:4007/auth", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="company"]', "EDDIE");
  await page.waitForTimeout(500);
  await page.locator('button[type="submit"]').first().click();

  await page.waitForTimeout(5000);
  console.log("URL:", page.url());

  // Check for any visible error text
  const bodyText = await page.locator("body").innerText();
  console.log("Body text snippet:", bodyText.substring(0, 500));

  await browser.close();
})();
