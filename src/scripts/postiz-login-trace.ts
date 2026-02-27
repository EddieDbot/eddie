import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Log all requests and responses
  page.on("request", req => {
    if (!req.url().includes("_next/static")) {
      console.log(`>> ${req.method()} ${req.url()}`);
    }
  });
  page.on("response", async res => {
    if (!res.url().includes("_next/static")) {
      const body = await res.text().catch(() => "");
      console.log(`<< ${res.status()} ${res.url()} — ${body.substring(0, 150)}`);
    }
  });
  page.on("console", msg => console.log(`CONSOLE [${msg.type()}]: ${msg.text()}`));

  await page.goto("http://debianhomelabx.tail48df71.ts.net:4007/auth/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  console.log("--- PAGE LOADED, URL:", page.url());

  // Fill login form
  await page.fill('input[name="email"]', "eddie@nac70x7.com");
  await page.fill('input[name="password"]', "EddieDbot2026!#");
  await page.waitForTimeout(500);
  await page.locator('button[type="submit"]').first().click();
  console.log("--- SUBMITTED");

  await page.waitForTimeout(5000);
  console.log("--- FINAL URL:", page.url());

  const cookies = await page.context().cookies();
  console.log("--- COOKIES:", JSON.stringify(cookies.map(c => ({name:c.name, domain:c.domain, value:c.value.substring(0,30)}))));

  await browser.close();
})();
