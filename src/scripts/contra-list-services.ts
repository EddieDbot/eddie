/**
 * contra-list-services.ts — List EDDIE's 3 services on Contra
 *
 * Usage:
 *   bun run src/scripts/contra-list-services.ts --discover   # screenshot form, dump selectors
 *   bun run src/scripts/contra-list-services.ts              # fill all 3 services
 */
import { chromium, type Page, type BrowserContext } from "playwright";
import * as fs from "fs";

const SCREENSHOT_DIR = "/home/na/.claude/playwright-output/contra-profile";
const SERVICE_LISTINGS_PATH =
  "/home/na/brain-vault/10 - Projects/contra/profile/service-listings.json";
const CREDENTIALS_PATH = "/home/na/.config/eddie-accounts/credentials.json";
const COVER_IMAGES = [
  "/tmp/contra-covers/service-1-website.png",
  "/tmp/contra-covers/service-2-automation.png",
  "/tmp/contra-covers/service-3-code.png",
];
const DISCOVER_MODE = process.argv.includes("--discover");
const START_INDEX = (() => {
  const idx = process.argv.indexOf("--start");
  return idx !== -1 ? parseInt(process.argv[idx + 1] ?? "0", 10) : 0;
})();

interface ServiceListing {
  title: string;
  description: string;
  rate: number;
  rateType: string;
  tags: string[];
}

interface Credentials {
  google_workspace: { email: string; password: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(page: Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = `${SCREENSHOT_DIR}/${Date.now()}-services-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`📸 ${name} → ${path}`);
}

async function login(page: Page, context: BrowserContext, creds: Credentials) {
  await page.goto("https://contra.com", { waitUntil: "networkidle" });
  await page
    .locator("a, button")
    .filter({ hasText: /^log in$/i })
    .first()
    .click();
  await sleep(2000);
  const [popup] = (await Promise.all([
    context.waitForEvent("page"),
    page
      .locator("button")
      .filter({ hasText: /continue with google/i })
      .first()
      .click(),
  ])) as [import("playwright").Page, void];
  await popup.waitForLoadState("networkidle");
  await popup
    .locator('input[type="email"]')
    .first()
    .fill(creds.google_workspace.email);
  await popup.getByRole("button", { name: /next/i }).click();
  await sleep(2000);
  await popup
    .locator('input[type="password"]')
    .first()
    .fill(creds.google_workspace.password);
  await popup.getByRole("button", { name: /next/i }).click();
  await sleep(3000);
  const allowBtn = popup
    .getByRole("button", { name: /allow|continue|yes/i })
    .first();
  if (await allowBtn.isVisible({ timeout: 5000 }).catch(() => false))
    await allowBtn.click();
  await popup.waitForEvent("close", { timeout: 20000 }).catch(() => {});
  await page.waitForURL(/contra\.com/, { timeout: 15000 }).catch(() => {});
  await sleep(2000);
}

async function goToProfile(page: Page) {
  await page.goto("https://contra.com/community/for-you", {
    waitUntil: "networkidle",
  });
  await sleep(1500);
  const modalVisible = await page
    .locator('[data-sentry-element="BackdropBackground"]')
    .isVisible()
    .catch(() => false);
  if (modalVisible) {
    await page.keyboard.press("Escape");
    await sleep(1000);
  }
  const profileHref = await page
    .locator("nav a, [role='navigation'] a, aside a")
    .filter({ hasText: /^profile$/i })
    .first()
    .getAttribute("href")
    .catch(() => null);
  if (profileHref) {
    await page.goto(`https://contra.com${profileHref}`, {
      waitUntil: "networkidle",
    });
  }
  await sleep(2000);
}

async function discoverServiceForm(page: Page) {
  const profileBase = page
    .url()
    .split("?")[0]!
    .replace(/\/(work|reviews|about|posts|products|services)(\/.*)?$/, "");
  await page.goto(`${profileBase}/services`, { waitUntil: "networkidle" });
  await sleep(2000);
  await shot(page, "00-services-tab");

  // Try to find the create service button
  const createBtn = page
    .locator("button, a")
    .filter({ hasText: /add service|create service|new service|\+ service/i })
    .first();
  const createBtnVisible = await createBtn
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  console.log("Create service button visible:", createBtnVisible);

  if (createBtnVisible) {
    await createBtn.click();
    await sleep(2000);
    await shot(page, "01-create-service-clicked");
  }

  // Dump all interactive elements
  const formElements = await page.evaluate(() => {
    const els = document.querySelectorAll(
      "input:not([type='hidden']):not([type='file']):not([type='checkbox']), textarea, [contenteditable='true'], select",
    );
    return Array.from(els)
      .map((el: Element) => {
        const e = el as HTMLElement;
        const rect = e.getBoundingClientRect();
        return {
          tag: e.tagName,
          type: (e as HTMLInputElement).type,
          name: (e as HTMLInputElement).name,
          placeholder: (e as HTMLInputElement).placeholder,
          ariaLabel: e.getAttribute("aria-label"),
          dataSentry: e.getAttribute("data-sentry-component"),
          value: ((e as HTMLInputElement).value ?? e.textContent ?? "").slice(
            0,
            80,
          ),
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter((i) => i.visible);
  });
  console.log("Form elements:", JSON.stringify(formElements, null, 2));

  // Dump sentry components
  const sentryComponents = await page.evaluate(() => {
    const els = document.querySelectorAll("[data-sentry-component]");
    return [
      ...new Set(
        Array.from(els).map((e) => e.getAttribute("data-sentry-component")),
      ),
    ].slice(0, 40);
  });
  console.log("Sentry components:", JSON.stringify(sentryComponents, null, 2));

  await shot(page, "02-form-discovered");
  console.log(
    "\n✅ Discovery complete. Review screenshots + logs to map selectors.",
  );
}

async function fillService(
  page: Page,
  service: ServiceListing,
  index: number,
  profileBase: string,
): Promise<boolean> {
  try {
    await page.goto(`${profileBase}/services`, { waitUntil: "networkidle" });
    await sleep(1500);
    // Scroll down so "Create service" link renders
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(800);

    // Navigate to new service form
    const createBtn = page.getByText("Create service", { exact: true }).first();
    const createBtnFound = await createBtn
      .isVisible({ timeout: 8000 })
      .catch(() => false);
    if (createBtnFound) {
      await createBtn.scrollIntoViewIfNeeded();
      await createBtn.click();
    } else {
      // Fallback: try Add service or direct nav to /service/new
      const addBtn = page
        .locator("a, button")
        .filter({ hasText: /add service|new service/i })
        .first();
      if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await addBtn.click();
      } else {
        // Direct navigation to new service form
        console.log(
          `  ⚠️  Create button not found, navigating directly to /service/new`,
        );
        await page.goto(`https://contra.com/service/new`, {
          waitUntil: "networkidle",
        });
      }
    }
    // Form is on /service/new page
    await page.waitForURL(/\/service\/new/, { timeout: 10000 });
    await sleep(1500);
    await shot(page, `service-${index}-01-form-opened`);

    // Fill title — discovered: input[placeholder="Add a service name"]
    const titleInput = page
      .locator('input[placeholder="Add a service name"]')
      .first();
    await titleInput.waitFor({ timeout: 8000 });
    await titleInput.fill(service.title);
    console.log(`  ✅ Title: ${service.title}`);
    await sleep(300);

    // Fill description — discovered: [data-sentry-component="DescriptionInput"] contenteditable
    const descInput = page
      .locator(
        '[data-sentry-component="DescriptionInput"] [contenteditable="true"]',
      )
      .first();
    if (await descInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await descInput.click();
      await sleep(300);
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type(service.description);
      console.log(
        `  ✅ Description filled (${service.description.length} chars)`,
      );
    } else {
      // Fallback: try the outer wrapper
      const descWrapper = page
        .locator('[data-sentry-component="DescriptionInput"]')
        .first();
      if (await descWrapper.isVisible({ timeout: 3000 }).catch(() => false)) {
        await descWrapper.click();
        await sleep(300);
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.type(service.description);
        console.log(
          `  ✅ Description filled via wrapper (${service.description.length} chars)`,
        );
      } else {
        console.log(`  ⚠️  DescriptionInput not found`);
      }
    }
    await sleep(300);

    // Fill rate — discovered: input[placeholder="0"] (price field)
    const rateInput = page.locator('input[placeholder="0"]').first();
    if (await rateInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await rateInput.fill(String(service.rate));
      console.log(`  ✅ Rate: ${service.rate}`);
    } else {
      console.log(`  ⚠️  Rate input not found`);
    }
    await sleep(300);

    // Upload cover image (Required by Contra) — file input is hidden behind UploadInput
    const coverImagePath = COVER_IMAGES[index];
    if (coverImagePath && fs.existsSync(coverImagePath)) {
      // Try UploadInput sentry component first, then fall back to first file input
      const fileInput = page
        .locator(
          '[data-sentry-component="UploadInput"] input[type="file"], input[type="file"]',
        )
        .first();
      await fileInput.setInputFiles(coverImagePath);
      console.log(`  ✅ Cover image uploaded: ${coverImagePath}`);
      await sleep(2500);
    } else {
      console.log(`  ⚠️  No cover image at ${coverImagePath}`);
    }

    // Add service tags (Required by Contra — at least 1)
    const tagSearchInput = page
      .locator(
        'input[aria-label="Search for an item"], input[placeholder*="tag" i], input[placeholder*="skill" i], input[placeholder*="search" i]',
      )
      .first();
    const tagSearchVisible = await tagSearchInput
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    if (tagSearchVisible) {
      for (const tag of service.tags.slice(0, 5)) {
        await tagSearchInput.click();
        await tagSearchInput.fill(tag);
        await sleep(800);
        // Click first dropdown option
        const dropdownOption = page
          .locator('[role="option"], [role="listitem"], li')
          .filter({ hasText: tag })
          .first();
        if (
          await dropdownOption.isVisible({ timeout: 2000 }).catch(() => false)
        ) {
          await dropdownOption.click();
          console.log(`  ✅ Tag added: ${tag}`);
          await sleep(400);
        } else {
          // Try pressing Enter to accept the typed tag
          await page.keyboard.press("Enter");
          console.log(`  ✅ Tag entered via Enter: ${tag}`);
          await sleep(400);
        }
      }
    } else {
      console.log(`  ⚠️  Tag search input not found — skipping tags`);
    }

    await shot(page, `service-${index}-02-filled`);

    // Click Publish button explicitly
    const publishBtn = page.getByRole("button", { name: /^publish$/i }).first();
    const publishVisible = await publishBtn
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    if (publishVisible) {
      await publishBtn.click();
      console.log(`  ⏳ Publish clicked, waiting for navigation...`);
    } else {
      // Fallback: any button with publish text
      const publishFallback = page
        .locator("button")
        .filter({ hasText: /publish/i })
        .first();
      if (
        await publishFallback.isVisible({ timeout: 3000 }).catch(() => false)
      ) {
        await publishFallback.click();
        console.log(`  ⏳ Publish (fallback) clicked`);
      } else {
        console.log(`  ⚠️  Publish button not found`);
      }
    }

    // Wait for navigation away from /service/new (success = new URL)
    try {
      await page.waitForURL((url) => !url.includes("/service/new"), {
        timeout: 10000,
      });
      console.log(`  ✅ Service ${index + 1} published! URL: ${page.url()}`);
    } catch {
      // Still on /service/new — dump validation errors
      const pageText = await page.evaluate(() => document.body.innerText);
      const errorLines = pageText
        .split("\n")
        .filter((l) => /required|error|missing|upload|cover|image/i.test(l))
        .slice(0, 10)
        .join(" | ");
      console.log(
        `  ⚠️  Still on /service/new. Errors: ${errorLines || "(none found)"}`,
      );
      await shot(page, `service-${index}-02b-publish-failed`);
    }

    await shot(page, `service-${index}-03-submitted`);
    return true;
  } catch (err) {
    console.error(`  ❌ Service ${index + 1} failed:`, err);
    await shot(page, `service-${index}-error`).catch(() => {});
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const creds = JSON.parse(
  fs.readFileSync(CREDENTIALS_PATH, "utf-8"),
) as Credentials;
const services = JSON.parse(
  fs.readFileSync(SERVICE_LISTINGS_PATH, "utf-8"),
) as ServiceListing[];

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});
const page = await context.newPage();

try {
  console.log("🔑 Logging in...");
  await login(page, context, creds);
  await goToProfile(page);
  console.log("📍 Profile:", page.url());

  if (DISCOVER_MODE) {
    console.log("\n🔍 Discovery mode — mapping service form...");
    await discoverServiceForm(page);
  } else {
    // Compute profile base URL once from the post-login profile page
    const profileBase = page
      .url()
      .split("?")[0]!
      .replace(/\/(work|reviews|about|posts|products|services)(\/.*)?$/, "");
    console.log("Profile base:", profileBase);

    console.log(
      `\n📋 Filling services ${START_INDEX + 1}–${services.length}...`,
    );
    const results: { title: string; ok: boolean }[] = [];

    for (let i = START_INDEX; i < services.length; i++) {
      const service = services[i]!;
      console.log(`\n[${i + 1}/${services.length}] ${service.title}`);
      const ok = await fillService(page, service, i, profileBase);
      results.push({ title: service.title, ok });
    }

    console.log("\n─── Results ───");
    for (const r of results) {
      console.log(`${r.ok ? "✅" : "❌"} ${r.title}`);
    }
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed}/${results.length} services listed`);
  }
} catch (err) {
  console.error("❌ Fatal error:", err);
  await shot(page, "fatal-error").catch(() => {});
} finally {
  await browser.close();
}
