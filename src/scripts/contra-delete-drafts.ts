/**
 * contra-delete-drafts.ts — Delete UNPUBLISHED duplicate services from EDDIE's
 * Contra services dashboard. Uses AuthSession cookie.
 *
 * Usage: bun run src/scripts/contra-delete-drafts.ts [--dry-run]
 */
import { launchBrowser, createContext } from "../browser/launcher.ts";
import * as fs from "fs";

const CREDENTIALS_PATH = "/home/na/.config/eddie-accounts/credentials.json";
const SCREENSHOT_DIR = "/home/na/.claude/playwright-output/contra-profile";
const DRY_RUN = process.argv.includes("--dry-run");

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8")) as any;
const authSession: string | undefined = creds?.contra?.auth_session;

if (!authSession) {
  console.error("❌ No Contra session cookie in credentials.json");
  process.exit(1);
}

const browser = await launchBrowser("stealth");
const context = await createContext(browser, "stealth");

try {
  await context.addCookies([
    {
      name: "AuthSession",
      value: authSession,
      domain: ".contra.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  const page = await context.newPage();
  await page.goto("https://contra.com/services", { waitUntil: "networkidle" });
  await sleep(3000);

  const url = page.url();
  if (url.includes("/login") || url.includes("/auth")) {
    console.error("❌ Not authenticated");
    process.exit(1);
  }

  const initialCount = await page
    .locator("tr")
    .filter({ hasText: "UNPUBLISHED" })
    .count();
  console.log(
    `Found ${initialCount} UNPUBLISHED service(s)${DRY_RUN ? " [DRY RUN]" : ""}`,
  );

  if (initialCount === 0) {
    console.log("Nothing to delete.");
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log("[DRY RUN] Done.");
    process.exit(0);
  }

  let deleted = 0;

  for (let i = 0; i < initialCount; i++) {
    const row = page.locator("tr").filter({ hasText: "UNPUBLISHED" }).first();
    const exists = await row.isVisible({ timeout: 3000 }).catch(() => false);
    if (!exists) break;

    console.log(`\nDeleting UNPUBLISHED service ${i + 1}/${initialCount}...`);

    // Hover to reveal action button
    await row.hover();
    await sleep(600);

    // Click the action button (SVG button inside row)
    const actionBtn = row.locator("button").first();
    await actionBtn.click({ force: true });

    // Wait for menu and click Delete via JS (exact text match)
    let clicked = false;
    for (let j = 0; j < 15; j++) {
      await sleep(150);
      clicked = await page.evaluate(() => {
        const containers = Array.from(
          document.querySelectorAll(
            "[data-radix-popper-content-wrapper], [role='menu']",
          ),
        );
        for (const c of containers) {
          for (const el of Array.from(c.querySelectorAll("*"))) {
            if (
              el.textContent?.trim() === "Delete" &&
              el.children.length <= 1 &&
              (el as HTMLElement).offsetWidth > 0
            ) {
              (el as HTMLElement).click();
              return true;
            }
          }
        }
        return false;
      });
      if (clicked) break;
    }

    if (!clicked) {
      console.log("  ⚠️  Delete option not found — pressing Escape");
      await page.keyboard.press("Escape");
      await page.screenshot({ path: `${SCREENSHOT_DIR}/delete-fail-${i}.png` });
      continue;
    }

    await sleep(600);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/delete-confirm-${i}.png`,
    });

    // Handle confirmation if present
    const confirmBtn = page
      .locator("button")
      .filter({ hasText: /^(confirm|yes|delete|delete service)$/i })
      .first();
    const hasConfirm = await confirmBtn
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (hasConfirm) {
      await confirmBtn.click();
      await sleep(2000);
    } else {
      await sleep(1500);
    }

    deleted++;
    console.log("  ✅ Done");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/after-delete-${i}.png` });
    await sleep(500);
  }

  console.log(`\n─── Results ───`);
  console.log(`Deleted: ${deleted} | Total UNPUBLISHED found: ${initialCount}`);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/dashboard-final.png` });
} finally {
  await browser.close();
}
