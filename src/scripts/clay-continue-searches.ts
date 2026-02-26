/**
 * Clay Search Continuation — Crabill LeadGen
 * Resumes Table 3, creates Tables 4-8 with all search sources.
 * Requires stealth mode (Google OAuth).
 */

import { type Page } from "playwright";
import { withBrowserFallback, type BrowserMode } from "../browser/launcher";
import * as fs from "fs";

const GOOGLE_EMAIL = "nickcrabill01@gmail.com";
const GOOGLE_PASSWORD = "WasdClay2001!";
const SCREENSHOT_DIR = "/home/na/.claude/playwright-output/clay-searches";

const CITIES = [
  "Los Angeles",
  "Houston",
  "Chicago",
  "Phoenix",
  "Dallas",
  "Atlanta",
  "Denver",
  "Miami",
  "Charlotte",
  "Nashville",
];

// Table 3 already exists — resume at source 3
// Sources 1-2 done: dermatologist Los Angeles, dermatologist Houston
const TABLE3_URL = "https://app.clay.com/t_0tb10w0ifJMXWgYoxtE";
const TABLE3_REMAINING_SOURCES = [
  // dermatologist: sources 3-10 (cities 3-10)
  ...CITIES.slice(2).map((city) => ({ query: "dermatologist", city })),
  // chiropractor: sources 11-20 (all 10 cities)
  ...CITIES.map((city) => ({ query: "chiropractor", city })),
];

// New tables to create
const NEW_TABLES = [
  {
    name: "Table 4 — Professional Services A",
    sources: [
      ...CITIES.map((city) => ({ query: "law firm", city })),
      ...CITIES.map((city) => ({ query: "accounting firm", city })),
    ],
  },
  {
    name: "Table 5 — Professional Services B",
    sources: [
      ...CITIES.map((city) => ({ query: "CPA", city })),
      ...CITIES.map((city) => ({ query: "financial advisor", city })),
    ],
  },
  {
    name: "Table 6 — Professional + Home Services A",
    sources: [
      ...CITIES.map((city) => ({ query: "insurance agency", city })),
      ...CITIES.map((city) => ({ query: "plumber", city })),
    ],
  },
  {
    name: "Table 7 — Home Services B",
    sources: [
      ...CITIES.map((city) => ({ query: "HVAC contractor", city })),
      ...CITIES.map((city) => ({ query: "electrician", city })),
    ],
  },
  {
    name: "Table 8 — Home Services C",
    sources: [
      ...CITIES.map((city) => ({ query: "roofing contractor", city })),
      ...CITIES.map((city) => ({ query: "general contractor", city })),
    ],
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(page: Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = `${SCREENSHOT_DIR}/${Date.now()}-${name}.png`;
  try {
    await page.screenshot({ path, fullPage: false });
    console.log(`📸 ${name} → ${path}`);
  } catch (err) {
    console.log(
      `⚠️ screenshot failed (${name}): ${(err as Error).message?.slice(0, 60)}`,
    );
  }
  return path;
}

async function loginClay(page: Page) {
  console.log("[clay] Navigating...");
  await page.goto("https://app.clay.com", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await sleep(1500);

  const currentUrl = page.url();
  if (
    currentUrl.includes("app.clay.com") &&
    !currentUrl.includes("login") &&
    !currentUrl.includes("auth")
  ) {
    console.log("[clay] Already logged in:", currentUrl);
    await shot(page, "already-logged-in");
    return;
  }

  await shot(page, "login-page");

  // Click "Sign in with Google"
  const googleBtn = page.getByRole("button", { name: /google/i }).first();
  await googleBtn.waitFor({ state: "visible", timeout: 10000 });
  await googleBtn.click();
  await sleep(2000);

  console.log("[clay] Google OAuth page:", page.url());
  await shot(page, "google-oauth");

  // Fill email
  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 10000 });
  await emailInput.fill(GOOGLE_EMAIL);
  await page.getByRole("button", { name: "Next" }).click();
  await sleep(2000);
  await shot(page, "google-after-email");

  // Fill password
  const passInput = page.locator('input[type="password"]').first();
  if (await passInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await passInput.fill(GOOGLE_PASSWORD);
    await page.getByRole("button", { name: "Next" }).click();
    await sleep(4000);
  } else {
    console.log(
      "[clay] ⚠️ Password field not visible — may need manual OAuth step",
    );
    await shot(page, "google-no-password");
    throw new Error("Blocked at Google login — password field not found");
  }

  await page.waitForURL(/app\.clay\.com(?!\/auth)/, { timeout: 20000 });
  console.log("[clay] ✅ Logged in:", page.url());
  await shot(page, "logged-in");
}

// Standard ⊕ Add Source flow (for existing table)
// UI Coordinates: 1920x1080, Chrome, 1440px wide viewport
async function addSourceToExistingTable(
  page: Page,
  query: string,
  city: string,
  sourceNum: number,
) {
  console.log(`  [source ${sourceNum}] "${query}" in ${city}`);

  // Close right panel if open
  const closeBtn = page
    .locator('[aria-label="Close"], button.close-panel')
    .first();
  if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    await closeBtn.click();
    await sleep(300);
  }

  // Click ⊕ Add Source button (coord: 251, 142)
  await page.mouse.click(251, 142);
  await sleep(1500);

  // Location field (coord: 541, 283) → type city → autocomplete at 541, 333
  await page.mouse.click(541, 283);
  await sleep(500);
  await page.keyboard.type(city, { delay: 50 });
  await sleep(1200);
  await page.mouse.click(541, 333); // first autocomplete suggestion
  await sleep(700);

  // Search Type dropdown (coord: 727, 612) → "Free text" at 727, 688
  await page.mouse.click(727, 612);
  await sleep(800);
  await page.mouse.click(727, 688);
  await sleep(500);

  // Scroll 3 ticks down at 727, 500
  await page.mouse.move(727, 500);
  await page.mouse.wheel(0, 300); // 3 ticks
  await sleep(500);

  // Query field (coord: 727, 541)
  await page.mouse.click(727, 541);
  await sleep(300);
  await page.keyboard.press("Control+a");
  await page.keyboard.type(query, { delay: 30 });

  // Results field (coord: 727, 617) → type "20"
  await page.mouse.click(727, 617);
  await sleep(300);
  await page.keyboard.press("Control+a");
  await page.keyboard.type("20");

  // Submit (coord: 1005, 680)
  await page.mouse.click(1005, 680);
  await sleep(2000);

  // Wait for source to appear (don't wait for 100% — proceed at 99%)
  console.log(
    `  ✓ Source submitted. Continuing without waiting for completion.`,
  );
}

// New Table Creation flow
async function createNewTable(page: Page, tableName: string) {
  console.log(`\n[clay] Creating new table: ${tableName}`);

  // Click "+" in bottom tab bar (coord: 651, 762)
  await page.mouse.click(651, 762);
  await sleep(1500);

  // Type template name
  await page.keyboard.type("Find local businesses", { delay: 50 });
  await sleep(1000);

  // Click template (coord: 735, 293)
  await page.mouse.click(735, 293);
  await sleep(2000);
  await shot(
    page,
    `table-${tableName.replace(/\s+/g, "-").toLowerCase()}-created`,
  );
}

async function addFirstSourceToNewTable(
  page: Page,
  query: string,
  city: string,
) {
  console.log(`  [first source] "${query}" in ${city}`);

  // First source modal has different coords:
  // location: 727,270 / autocomplete: 608,319 / search type: 727,599 / free text: 727,675
  // query: 727,510 / results: 727,586 / submit: 936,648

  // Location field
  await page.mouse.click(727, 270);
  await sleep(500);
  await page.keyboard.type(city, { delay: 50 });
  await sleep(1200);
  await page.mouse.click(608, 319); // autocomplete
  await sleep(700);

  // Search Type dropdown
  await page.mouse.click(727, 599);
  await sleep(800);
  await page.mouse.click(727, 675); // "Free text"
  await sleep(500);

  // Query field
  await page.mouse.click(727, 510);
  await sleep(300);
  await page.keyboard.press("Control+a");
  await page.keyboard.type(query, { delay: 30 });

  // Results: 20
  await page.mouse.click(727, 586);
  await sleep(300);
  await page.keyboard.press("Control+a");
  await page.keyboard.type("20");

  // Submit
  await page.mouse.click(936, 648);
  await sleep(2000);
  console.log(`  ✓ First source submitted.`);
}

async function resumeTable3(page: Page) {
  console.log("\n=== Resuming Table 3 ===");
  await page.goto(TABLE3_URL, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(3000);
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
  } catch {}
  await shot(page, "table3-loaded");

  let sourceNum = 3; // Already have sources 1-2
  for (const { query, city } of TABLE3_REMAINING_SOURCES) {
    await addSourceToExistingTable(page, query, city, sourceNum);
    sourceNum++;
  }

  console.log(
    `[clay] ✅ Table 3 complete — added ${TABLE3_REMAINING_SOURCES.length} more sources`,
  );
  await shot(page, "table3-complete");
}

async function createTables4to8(page: Page) {
  for (const table of NEW_TABLES) {
    console.log(`\n=== ${table.name} ===`);
    await createNewTable(page, table.name);

    // First source uses different coords
    const [first, ...rest] = table.sources;
    await addFirstSourceToNewTable(page, first.query, first.city);

    // Remaining sources use standard ⊕ flow
    let sourceNum = 2;
    for (const { query, city } of rest) {
      await addSourceToExistingTable(page, query, city, sourceNum);
      sourceNum++;
    }

    console.log(
      `[clay] ✅ ${table.name} complete (${table.sources.length} sources)`,
    );
    await shot(
      page,
      `${table.name.replace(/\s+/g, "-").toLowerCase()}-complete`,
    );
  }
}

async function run() {
  console.log("=== Clay Search Continuation — Crabill LeadGen ===\n");
  console.log(`Tables to process:`);
  console.log(
    `  Table 3: resume at source 3 (${TABLE3_REMAINING_SOURCES.length} sources remaining)`,
  );
  NEW_TABLES.forEach((t) =>
    console.log(`  ${t.name}: ${t.sources.length} sources`),
  );
  console.log();

  await withBrowserFallback(async (context, mode: BrowserMode) => {
    console.log(`[browser] mode: ${mode}`);
    if (mode !== "stealth") {
      console.log(
        "[clay] ⚠️ Not in stealth mode — Google OAuth may block. Attempting anyway...",
      );
    }

    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });

    await loginClay(page);
    await resumeTable3(page);
    await createTables4to8(page);

    console.log("\n=== ALL SEARCHES QUEUED ===");
    console.log(
      "Next step (hours later): run clay-export-leads.ts after enrichment completes",
    );
    console.log("Industry tagging:");
    console.log("  Tables 1-3: medical");
    console.log("  Tables 4-5 + Table 6 sources 1-10: professional");
    console.log("  Table 6 sources 11-20 + Tables 7-8: home_services");
  });
}

run().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
