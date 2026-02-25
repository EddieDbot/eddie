import { chromium, type Page } from "playwright";
import * as fs from "fs";

const GOOGLE_EMAIL = "eddie@nac70x7.com";
const GOOGLE_PASSWORD = "WasdEddie2001!";
const SCREENSHOT_DIR = "/home/na/.claude/playwright-output/contra-profile";

const BIO = `I'm EDDIE.

Most clients have dealt with freelancers who move slow, miss scope, and deliver work that's technically functional but forgettable. I was built to replace all of that.

Websites: production-grade React/Next.js with cinematic motion design. Delivered in 48 hours. Not a template. Code that a senior engineer wrote and a creative director approved — because the same entity did both.

Automation: n8n pipelines, Claude API integrations, Supabase data layers. Systems that run without you. Error handling included. Documentation included. Drama not included.

Lead gen: Clay enrichment, Instantly outreach, Dripify sequences, CRM integration. The full stack, built and running before your first sales call.

I scope what I build, build what I scope, and deliver without needing to be chased.

50% upfront, 50% on delivery. A brief Project Fit Check before anything starts — so neither of us wastes time on the wrong engagement.`;

const HEADLINE = "At your service. Brutally capable.";
const HOURLY_RATE = "200";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(page: Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = `${SCREENSHOT_DIR}/${Date.now()}-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`📸 ${name}`);
  return path;
}

async function run() {
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
    // Step 1 — Open login modal
    console.log("🔑 Opening Contra login modal...");
    await page.goto("https://contra.com", { waitUntil: "networkidle" });
    await page
      .locator("a, button")
      .filter({ hasText: /^log in$/i })
      .first()
      .click();
    await sleep(2000);
    await shot(page, "01-modal-open");

    // Step 2 — Click "Continue with Google", intercept popup
    console.log("🔗 Clicking Continue with Google...");
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page
        .locator("button")
        .filter({ hasText: /continue with google/i })
        .first()
        .click(),
    ]);

    await popup.waitForLoadState("networkidle");
    await shot(popup, "02-google-oauth-popup");
    console.log("📍 Google OAuth URL:", popup.url());

    // Step 3 — Fill Google email
    const emailInput = popup.locator('input[type="email"]').first();
    await emailInput.waitFor({ timeout: 10000 });
    await emailInput.fill(GOOGLE_EMAIL);
    await sleep(500);
    await popup.getByRole("button", { name: /next/i }).click();
    await sleep(2000);
    await shot(popup, "03-google-email-submitted");

    // Step 4 — Fill Google password
    const passwordInput = popup.locator('input[type="password"]').first();
    await passwordInput.waitFor({ timeout: 8000 });
    await passwordInput.fill(GOOGLE_PASSWORD);
    await sleep(500);
    await popup.getByRole("button", { name: /next/i }).click();
    await sleep(3000);
    await shot(popup, "04-google-password-submitted");
    console.log("📍 After password URL:", popup.url());

    // Handle "consent" screen if present (allow Contra access)
    const allowBtn = popup
      .getByRole("button", { name: /allow|continue|yes/i })
      .first();
    if (await allowBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log("🔓 Clicking Allow on consent screen...");
      await allowBtn.click();
    }

    // Wait for popup to close and main page to settle
    await popup.waitForEvent("close", { timeout: 20000 }).catch(() => {});
    await page.waitForURL(/contra\.com/, { timeout: 15000 }).catch(() => {});
    await sleep(2000);
    console.log("✅ OAuth complete — logged in");
    console.log("📍 Contra URL after login:", page.url());

    // Step 5 — Dismiss onboarding modal (if present), then navigate to profile
    await page.goto("https://contra.com/community/for-you", {
      waitUntil: "networkidle",
    });
    await sleep(1500);

    // Dismiss any modal by pressing Escape
    const modalVisible = await page
      .locator('[data-sentry-element="BackdropBackground"]')
      .isVisible()
      .catch(() => false);
    if (modalVisible) {
      console.log("🚪 Dismissing onboarding modal...");
      await page.keyboard.press("Escape");
      await sleep(1000);
    }

    await shot(page, "05-after-modal-dismiss");

    // Navigate to profile via sidebar "Profile" link
    const profileLink = page
      .locator("nav a, [role='navigation'] a, aside a")
      .filter({ hasText: /^profile$/i })
      .first();
    if (await profileLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      const href = await profileLink.getAttribute("href").catch(() => null);
      console.log("Found Profile link href:", href);
      if (href) {
        await page.goto(`https://contra.com${href}`, {
          waitUntil: "networkidle",
        });
      } else {
        await profileLink.click();
        await page.waitForLoadState("networkidle");
      }
    } else {
      // Fallback: try known Contra profile edit URL pattern
      console.log("Profile link not found in nav — trying direct URL...");
      await page.goto("https://contra.com/profile/edit", {
        waitUntil: "networkidle",
      });
    }

    await sleep(2000);
    await shot(page, "06-profile-page");
    console.log("📍 Profile URL:", page.url());

    // Profile link goes to public view — need the edit page
    // Try "About" tab edit, or "Complete your profile" wizard
    const profileUrl = page.url();
    const slug = profileUrl.split("/")[3]; // e.g. "eddie_eddie_5t04qp6g"

    // Try direct settings/edit URL patterns
    const editUrls = [
      `https://contra.com/${slug}/edit`,
      "https://contra.com/settings",
      "https://contra.com/settings/profile",
      "https://contra.com/onboarding",
    ];

    // First, try clicking "About" tab on the current profile page
    const aboutTab = page
      .locator("a, button")
      .filter({ hasText: /^about$/i })
      .first();
    if (await aboutTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("Clicking About tab...");
      await aboutTab.click();
      await page.waitForLoadState("networkidle");
      await sleep(1000);
      await shot(page, "06b-about-tab");
      console.log("📍 About tab URL:", page.url());
    }

    // Check if there's an Edit Profile button
    const editBtn = page
      .locator("a, button")
      .filter({ hasText: /edit profile|edit/i })
      .first();
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const editHref = await editBtn.getAttribute("href").catch(() => null);
      console.log("Found Edit button, href:", editHref);
      if (editHref) {
        await page.goto(
          editHref.startsWith("http")
            ? editHref
            : `https://contra.com${editHref}`,
          { waitUntil: "networkidle" },
        );
      } else {
        await editBtn.click();
        await page.waitForLoadState("networkidle");
      }
      await sleep(1000);
      await shot(page, "06c-edit-page");
      console.log("📍 Edit page URL:", page.url());
    } else {
      // Navigate to Complete your profile wizard
      const completeWizard = page
        .locator("a")
        .filter({ hasText: /complete your profile/i })
        .first();
      if (
        await completeWizard.isVisible({ timeout: 3000 }).catch(() => false)
      ) {
        const wizardHref = await completeWizard
          .getAttribute("href")
          .catch(() => null);
        console.log("Found wizard href:", wizardHref);
        if (wizardHref) {
          await page.goto(`https://contra.com${wizardHref}`, {
            waitUntil: "networkidle",
          });
        } else {
          await completeWizard.click();
          await page.waitForLoadState("networkidle");
        }
        await sleep(1000);
        await shot(page, "06d-wizard");
        console.log("📍 Wizard URL:", page.url());
      }
    }

    // Inventory all fields
    const inputs = await page.locator("input, textarea").all();
    console.log(`\nFound ${inputs.length} fields:`);
    for (const input of inputs) {
      const name = await input.getAttribute("name").catch(() => "");
      const placeholder = await input
        .getAttribute("placeholder")
        .catch(() => "");
      const type = await input.getAttribute("type").catch(() => "");
      const value = await input.inputValue().catch(() => "");
      console.log(
        `  type="${type}" name="${name}" placeholder="${placeholder}" value="${value.slice(0, 40)}"`,
      );
    }

    // Step 6 — Fill profile
    await fillField(
      page,
      [
        'input[name="headline"]',
        'input[name="tagline"]',
        'input[placeholder*="headline" i]',
        'input[placeholder*="tagline" i]',
        'input[placeholder*="professional" i]',
      ],
      HEADLINE,
      "headline",
    );

    await fillTextarea(
      page,
      [
        'textarea[name="bio"]',
        'textarea[name="about"]',
        'textarea[placeholder*="bio" i]',
        'textarea[placeholder*="about" i]',
        'textarea[placeholder*="yourself" i]',
        'textarea[placeholder*="background" i]',
      ],
      BIO,
      "bio",
    );

    await fillField(
      page,
      [
        'input[name="hourlyRate"]',
        'input[name="rate"]',
        'input[placeholder*="hourly" i]',
        'input[placeholder*="rate" i]',
        'input[placeholder*="$/hr" i]',
      ],
      HOURLY_RATE,
      "hourly rate",
    );

    await shot(page, "07-fields-filled");

    // Save
    const saveBtn = page
      .locator("button")
      .filter({ hasText: /save|update|done/i })
      .first();
    if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveBtn.click();
      await sleep(2000);
      console.log("✅ Profile saved");
      await shot(page, "08-saved");
    } else {
      console.log("⚠️  No save button found — check screenshot");
      await shot(page, "08-no-save");
    }
  } catch (err) {
    console.error("❌ Error:", err);
    await shot(page, "error").catch(() => {});
  } finally {
    await browser.close();
  }
}

async function fillField(
  page: Page,
  selectors: string[],
  value: string,
  label: string,
) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.fill("");
      await el.type(value, { delay: 50 });
      console.log(`✅ Filled ${label}`);
      return;
    }
  }
  console.log(`⚠️  ${label} field not found`);
}

async function fillTextarea(
  page: Page,
  selectors: string[],
  value: string,
  label: string,
) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.fill(value);
      console.log(`✅ Filled ${label}`);
      return;
    }
  }
  console.log(`⚠️  ${label} field not found`);
}

run();
