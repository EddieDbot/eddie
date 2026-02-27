import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://localhost:4007", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  console.log("Final URL:", page.url());
  // Look for input fields and links
  const inputs = await page.locator("input").all();
  for (const input of inputs) {
    const type = await input.getAttribute("type");
    const name = await input.getAttribute("name");
    const placeholder = await input.getAttribute("placeholder");
    console.log(`input: type=${type} name=${name} placeholder=${placeholder}`);
  }
  const links = await page.locator("a").all();
  for (const link of links) {
    const href = await link.getAttribute("href");
    const text = await link.textContent();
    if (href) console.log(`link: ${href} — "${text?.trim()}"`);
  }
  await browser.close();
})();
