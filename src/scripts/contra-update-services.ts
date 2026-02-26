/**
 * contra-update-services.ts — Edit existing published Contra services
 * (update description + price) without creating new ones.
 *
 * Reads slugs from service-listings.json and navigates to each /s/{slug}/edit page.
 *
 * Usage: bun run src/scripts/contra-update-services.ts [--dry-run]
 */
import { launchBrowser, createContext } from "../browser/launcher.ts";
import type { Page } from "playwright";
import * as fs from "fs";

const CREDENTIALS_PATH = "/home/na/.config/eddie-accounts/credentials.json";
const SERVICE_LISTINGS_PATH =
  "/home/na/brain-vault/10 - Projects/contra/profile/service-listings.json";
const SCREENSHOT_DIR = "/home/na/.claude/playwright-output/contra-profile";
const DRY_RUN = process.argv.includes("--dry-run");

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ServiceListing {
  slug: string;
  title: string;
  description: string;
  rate: number;
  rateType: string;
}

const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8")) as any;
const authSession: string | undefined = creds?.contra?.auth_session;
const services = JSON.parse(
  fs.readFileSync(SERVICE_LISTINGS_PATH, "utf-8"),
) as ServiceListing[];

if (!authSession) {
  console.error("❌ No Contra session cookie in credentials.json");
  process.exit(1);
}

async function updateService(page: Page, svc: ServiceListing): Promise<boolean> {
  const editUrl = `https://contra.com/s/${svc.slug}/edit`;
  console.log(`\nNavigating to: ${editUrl}`);

  await page.goto(editUrl, { waitUntil: "networkidle" });
  await sleep(2500);

  const url = page.url();
  if (!url.includes("/edit")) {
    console.log(`  ❌ Unexpected URL: ${url}`);
    return false;
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would update: ${svc.title} → $${svc.rate}`);
    return true;
  }

  // ── Description ───────────────────────────────────────────────────────────
  const descInput = page
    .locator('[data-sentry-component="DescriptionInput"] [contenteditable="true"]')
    .first();

  const descVisible = await descInput.isVisible({ timeout: 5000 }).catch(() => false);
  if (descVisible) {
    await descInput.click();
    await sleep(300);
    // Select all and replace
    await page.keyboard.press("ControlOrMeta+a");
    await sleep(100);
    // Type character by character is slow for long text — use clipboard paste instead
    await page.evaluate((text: string) => {
      const el = document.querySelector(
        '[data-sentry-component="DescriptionInput"] [contenteditable="true"]'
      ) as HTMLElement;
      if (el) {
        el.focus();
        document.execCommand("selectAll");
        document.execCommand("insertText", false, text);
      }
    }, svc.description);
    await sleep(500);
    console.log(`  ✅ Description updated (${svc.description.length} chars)`);
  } else {
    console.log(`  ⚠️  Description input not found`);
  }

  // ── Price ─────────────────────────────────────────────────────────────────
  const rateInput = page.locator('input[placeholder="0"]').first();
  const rateVisible = await rateInput.isVisible({ timeout: 5000 }).catch(() => false);
  if (rateVisible) {
    await rateInput.fill("");
    await sleep(200);
    await rateInput.fill(String(svc.rate));
    await sleep(300);
    console.log(`  ✅ Price: $${svc.rate}`);
  } else {
    // Price might be in a different section — scroll and try again
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1000);
    const rateInputScrolled = page.locator('input[placeholder="0"]').first();
    if (await rateInputScrolled.isVisible({ timeout: 3000 }).catch(() => false)) {
      await rateInputScrolled.fill(String(svc.rate));
      console.log(`  ✅ Price (after scroll): $${svc.rate}`);
    } else {
      console.log(`  ⚠️  Price input not found`);
    }
  }

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/update-${svc.slug.slice(0, 8)}-filled.png`,
  });

  // ── Save (Publish keeps it published) ─────────────────────────────────────
  const publishBtn = page.locator("button").filter({ hasText: /^publish$/i }).first();
  const publishVisible = await publishBtn.isVisible({ timeout: 3000 }).catch(() => false);

  if (publishVisible) {
    await publishBtn.click({ force: true });
    await sleep(3000);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/update-${svc.slug.slice(0, 8)}-saved.png`,
    });
    const finalUrl = page.url();
    console.log(`  ✅ Saved. URL: ${finalUrl}`);
    return true;
  }

  // Fallback: Save as unpublished
  const saveBtn = page.locator("button").filter({ hasText: /save as unpublished/i }).first();
  if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await saveBtn.click({ force: true });
    await sleep(3000);
    console.log(`  ⚠️  Saved as unpublished (Publish button not found)`);
    return true;
  }

  console.log(`  ❌ No save button found`);
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const browser = await launchBrowser("stealth");
const context = await createContext(browser, "stealth");

try {
  await context.addCookies([{
    name: "AuthSession",
    value: authSession,
    domain: ".contra.com",
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  }]);

  const page = await context.newPage();

  // Verify auth
  await page.goto("https://contra.com/services", { waitUntil: "networkidle" });
  await sleep(2000);
  if (page.url().includes("/login")) {
    console.error("❌ Not authenticated");
    process.exit(1);
  }
  console.log("✅ Authenticated");

  let passed = 0;
  let failed = 0;

  for (const svc of services) {
    console.log(`\n[${services.indexOf(svc) + 1}/${services.length}] ${svc.title}`);
    const ok = await updateService(page, svc);
    if (ok) passed++;
    else failed++;
    await sleep(1000);
  }

  console.log(`\n─── Results ───`);
  console.log(`Updated: ${passed} | Failed: ${failed}`);
} finally {
  await browser.close();
}
